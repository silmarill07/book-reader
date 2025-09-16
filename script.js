// Utility function for debouncing
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

// Book Reader - JavaScript функциональность для WebView

class BookReader {
    constructor() {
        this.books = [];
        this.currentBook = null;
        this.currentChapter = 0;
        this.readingPosition = 0;
        this.settings = {
            fontSize: 18,
            lineHeight: 1.8,
            theme: 'light'
        };
        this.epubBook = null; // To hold the Epub.js Book instance
        this.rendition = null; // To hold the Epub.js Rendition instance
        this.restTimer = null;
        this.restInterval = null;
        this.readingTime = 2700000; // 45 minutes in milliseconds
        this.restTime = 60; // 60 seconds
        this.wakeLock = null; // To hold the wake lock sentinel
        
        this.init();
    }

    init() {
        this.loadSettings();
        this.loadBooks();
        this.bindEvents();
        this.updateUI();
        this.applySettings();
        
        // Восстанавливаем последнюю читаемую книгу
        if (this.books.length > 0) {
            const lastBookId = localStorage.getItem('lastBookId');
            if (lastBookId) {
                const book = this.books.find(b => b.id === lastBookId);
                if (book) {
                    this.openBook(book);
                }
            }
        }
    }

    bindEvents() {
        // Навигация
        document.getElementById('closeMenuBtn').addEventListener('click', () => this.closeSideMenu());
        document.getElementById('homeBtn').addEventListener('click', () => this.showLibrary());
        document.getElementById('chaptersBtn').addEventListener('click', () => this.toggleSideMenu());
        document.getElementById('overlay').addEventListener('click', () => this.closeSideMenu());
        
        // Загрузка книг
        document.getElementById('addBookBtnMain').addEventListener('click', () => this.openFileDialog());
        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileUpload(e));
        
        // Настройки
        document.getElementById('settingsBtn').addEventListener('click', () => this.showSettings());
        document.getElementById('closeSettingsBtn').addEventListener('click', () => this.hideSettings());
        
        // Управление шрифтом
        document.getElementById('fontSizeDecrease').addEventListener('click', () => this.changeFontSize(-1));
        document.getElementById('fontSizeIncrease').addEventListener('click', () => this.changeFontSize(1));
        document.getElementById('lineHeightDecrease').addEventListener('click', () => this.changeLineHeight(-0.1));
        document.getElementById('lineHeightIncrease').addEventListener('click', () => this.changeLineHeight(0.1));
        
        // Выбор темы
        document.querySelectorAll('.theme-option').forEach(option => {
            option.addEventListener('click', () => this.selectTheme(option.dataset.theme));
        });
        
        // Главы (теперь в боковом меню)
        document.getElementById('closeChaptersBtn').addEventListener('click', () => this.hideChapters());
        
        // Удаление книг
        document.getElementById('cancelDeleteBtn').addEventListener('click', () => this.hideDeleteModal());
        document.getElementById('confirmDeleteBtn').addEventListener('click', () => this.confirmDelete());
        
        // Закрытие модальных окон по клику вне их
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideAllModals();
                }
            });
        });

        // Page Visibility API
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopRestTimer();
            } else {
                this.startRestTimer();
            }
        });
    }

    // Rest timer
    startRestTimer() {
        if (this.currentBook) {
            this.restTimer = setTimeout(() => {
                this.showRestModal();
            }, this.readingTime);
        }
    }

    stopRestTimer() {
        clearTimeout(this.restTimer);
    }

    resetRestTimer() {
        this.stopRestTimer();
        this.startRestTimer();
    }

    showRestModal() {
        document.body.classList.add('modal-open');
        document.getElementById('restModal').classList.add('open');
        let timeLeft = this.restTime;
        const restTimeElement = document.getElementById('restTime');
        restTimeElement.textContent = timeLeft;

        this.restInterval = setInterval(() => {
            timeLeft--;
            restTimeElement.textContent = timeLeft;
            if (timeLeft <= 0) {
                this.hideRestModal();
            }
        }, 1000);
    }

    hideRestModal() {
        document.body.classList.remove('modal-open');
        document.getElementById('restModal').classList.remove('open');
        clearInterval(this.restInterval);
        this.resetRestTimer();
    }

    // Управление книгами
    async handleFileUpload(event) {
        const files = Array.from(event.target.files);
        
        for (const file of files) {
            try {
                const book = await this.parseBook(file);
                if (book) {
                    const isDuplicate = this.books.some(existingBook => 
                        existingBook.title === book.title && existingBook.author === book.author
                    );

                    if (isDuplicate) {
                        this.showNotification(`Book "${book.title}" by ${book.author} is already in your library.`);
                        continue; // Skip to the next file
                    }

                    if (book.fileType === 'epub' && book.epubFile) {
                        try {
                            await bookDB.saveEpubFile(book.id, book.epubFile);
                            // The epubFile content is now stored in IndexedDB, no need to keep it in the book object
                            delete book.epubFile; 
                        } catch (e) {
                            throw new Error('Could not save EPUB file to IndexedDB. File might be too large or IndexedDB is not available.');
                        }
                    }
                    this.books.push(book);
                }
            } catch (error) {
                console.error('Помилка при завантаженні книги:', error);
                this.showNotification(`Помилка при завантаженні файлу ${file.name}: ${error.message}`);
            }
        }
        
        this.saveBooks();
        this.updateLibrary();
        this.closeSideMenu();
        event.target.value = '';
    }

    async parseBook(file) {
        // Получаем расширение файла из MIME типа или имени файла
        const fileExtension = this.getFileExtension(file);
        
        console.log('Parsing file:', {
            name: file.name,
            type: file.type,
            size: file.size,
            extension: fileExtension
        });
        
        switch (fileExtension) {
            case 'fb2':
                return await this.parseFB2(file);
            case 'txt':
                return await this.parseTXT(file);
            case 'epub':
                return await this.parseEPUB(file);
            default:
                throw new Error(`Непідтримуваний формат файлу: ${fileExtension}. Підтримуються: FB2, TXT, EPUB`);
        }
    }

    getFileExtension(file) {
        // Сначала пытаемся определить по MIME типу
        const mimeTypes = {
            'application/x-fictionbook+xml': 'fb2',
            'application/x-fictionbook': 'fb2',
            'text/xml': 'fb2',
            'application/xml': 'fb2',
            'text/plain': 'txt',
            'application/epub+zip': 'epub',
            'application/octet-stream': null // Для неопределенных типов проверяем расширение
        };
        
        if (file.type && mimeTypes[file.type]) {
            return mimeTypes[file.type];
        }
        
        // Если MIME тип не определен, используем расширение файла
        const nameExtension = file.name.split('.').pop().toLowerCase();
        
        // Проверяем, что это действительно поддерживаемое расширение
        const supportedExtensions = ['fb2', 'txt', 'epub'];
        if (supportedExtensions.includes(nameExtension)) {
            return nameExtension;
        }
        
        // Если файл с неизвестным расширением, но содержимое может быть XML (FB2)
        if (file.type === 'text/xml' || file.type === 'application/xml' || 
            file.name.toLowerCase().includes('fb2')) {
            return 'fb2';
        }
        
        return nameExtension;
    }

    async parseFB2(file) {
        const text = await this.readFileAsText(file);
        
        // Проверяем, что это действительно FB2 файл
        if (!text.includes('<FictionBook') && !text.includes('<fictionbook')) {
            throw new Error('Файл не є валідним FB2 файлом');
        }
        
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');
        
        // Проверяем на ошибки парсинга
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
            console.warn('XML parsing warning:', parserError.textContent);
            // Пытаемся очистить и повторно распарсить
            const cleanText = this.cleanXMLText(text);
            const cleanXmlDoc = parser.parseFromString(cleanText, 'text/xml');
            const cleanParserError = cleanXmlDoc.querySelector('parsererror');
            if (!cleanParserError) {
                return this.extractFB2Data(cleanXmlDoc, file);
            }
        }
        
        return this.extractFB2Data(xmlDoc, file);
    }

    cleanXMLText(text) {
        // Убираем проблемные символы
        return text
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // Удаляем управляющие символы
            .replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;') // Экранируем неэкранированные амперсанды
            .trim();
    }

    extractFB2Data(xmlDoc, file) {
        // Извлекаем метаданные
        const title = this.getTextContent(xmlDoc, 'book-title') || 
                     this.getTextContent(xmlDoc, 'title') || 
                     file.name.replace(/\.(fb2|FB2)$/i, '');
        
        const firstName = this.getTextContent(xmlDoc, 'first-name') || '';
        const lastName = this.getTextContent(xmlDoc, 'last-name') || '';
        const author = (firstName + ' ' + lastName).trim() || 
                      this.getTextContent(xmlDoc, 'author') || 
                      'Невідомий автор';
        
        // Извлекаем обложку
        let coverImage = null;
        const coverElement = xmlDoc.querySelector('coverpage image');
        if (coverElement) {
            const href = coverElement.getAttribute('l:href') || coverElement.getAttribute('href');
            if (href) {
                const binaryElement = xmlDoc.querySelector(`binary[id="${href.replace('#', '')}"]`);
                if (binaryElement) {
                    const base64 = binaryElement.textContent.trim();
                    const contentType = binaryElement.getAttribute('content-type') || 'image/jpeg';
                    coverImage = `data:${contentType};base64,${base64}`;
                }
            }
        }
        
        // Извлекаем содержимое
        const body = xmlDoc.querySelector('body');
        if (!body) throw new Error('Не вдалося знайти вміст книги в FB2 файлі');
        
        const chapters = this.extractChapters(body);
        
        if (chapters.length === 0) {
            throw new Error('Не вдалося витягти глави з FB2 файлу');
        }
        
        return {
            id: this.generateId(),
            title: title.trim(),
            author: author.trim(),
            coverImage,
            chapters, // TOC items
            fileType: 'fb2',
            fileName: file.name,
            addedDate: new Date().toISOString(),
            readingProgress: 0,
            currentChapter: 0,
            currentPosition: 0
        };
    }

    async parseTXT(file) {
        const text = await this.readFileAsText(file);
        
        if (!text || text.trim().length === 0) {
            throw new Error('TXT файл порожній або не читається');
        }
        
        const lines = text.split('\n');
        
        // Простое разделение на главы по заголовкам
        const chapters = [];
        let currentChapter = { title: 'Глава 1', content: '' };
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Определяем заголовки глав
            if (this.isChapterTitle(trimmedLine)) {
                if (currentChapter.content.trim()) {
                    chapters.push(currentChapter);
                }
                currentChapter = { 
                    title: trimmedLine || `Глава ${chapters.length + 1}`, 
                    content: '' 
                };
            } else {
                currentChapter.content += line + '\n';
            }
        }
        
        if (currentChapter.content.trim()) {
            chapters.push(currentChapter);
        }
        
        if (chapters.length === 0) {
            chapters.push({ title: 'Книга', content: text });
        }
        
        return {
            id: this.generateId(),
            title: file.name.replace(/\.(txt|TXT)$/i, ''),
            author: 'Невідомий автор',
            coverImage: null,
            chapters,
            fileType: 'txt',
            fileName: file.name,
            addedDate: new Date().toISOString(),
            readingProgress: 0,
            currentChapter: 0,
            currentPosition: 0
        };
    }

    isChapterTitle(line) {
        if (!line || line.length === 0) return false;
        
        // Различные паттерны для определения заголовков глав
        const patterns = [
            /^(Глава|Chapter|Розділ)\s+\d+/i,
            /^\d+\.\s+/,
            /^[А-ЯA-Z][А-ЯЁЮІЇЄҐA-Z\s]{10,100}$/,
            /^[IVX]+\.\s+/i,
        ];
        
        return patterns.some(pattern => pattern.test(line)) &&
               line.length < 100 &&
               !line.includes('.') ||
               (line.length > 0 && line.length < 100 && 
                line.toUpperCase() === line && 
                !line.includes('!') && !line.includes('?'));
    }

    async parseEPUB(file) {
        console.log('Parsing EPUB file:', file);
        try {
            if (!window.ePub) {
                throw new Error('ePub.js library is not loaded.');
            }
            const book = window.ePub(file);
            console.log('ePub book created:', book);

            await book.ready;
            console.log('ePub book ready');

            const metadata = await book.loaded.metadata;
            console.log('ePub metadata loaded:', metadata);
            const toc = await book.loaded.navigation.toc;
            console.log('ePub toc loaded:', toc);

            const title = metadata.title || file.name.replace(/\.(epub|EPUB)$/i, '');
            const author = metadata.creator || 'Невідомий автор';

            let coverImage = null;
            if (book.cover) {
                coverImage = await book.coverUrl();
                console.log('ePub cover image loaded:', coverImage);
            }

            const epubFileBase64 = await this.readFileAsBase64(file);
            console.log('ePub file converted to base64');

            const chapters = (toc || []).map(item => ({
                title: item.label,
                href: item.href
            }));

            return {
                id: this.generateId(),
                title: title.trim(),
                author: author.trim(),
                coverImage,
                chapters,
                fileType: 'epub',
                fileName: file.name,
                addedDate: new Date().toISOString(),
                currentChapter: 0,
                currentPosition: 0,
                epubFile: epubFileBase64
            };
        } catch (error) {
            console.error('Error parsing EPUB:', error);
            throw error;
        }
    }

    extractChapters(body) {
        const chapters = [];
        const sections = body.querySelectorAll('section');
        
        if (sections.length === 0) {
            // Если нет секций, ищем заголовки
            const titles = body.querySelectorAll('title, h1, h2, h3');
            if (titles.length > 0) {
                let currentChapter = null;
                const walker = document.createTreeWalker(
                    body,
                    NodeFilter.SHOW_ELEMENT,
                    null,
                    false
                );
                
                let node;
                while (node = walker.nextNode()) {
                    if (['title', 'h1', 'h2', 'h3'].includes(node.tagName.toLowerCase())) {
                        if (currentChapter) {
                            chapters.push(currentChapter);
                        }
                        currentChapter = {
                            title: this.getTextContent(node) || 'Глава',
                            content: ''
                        };
                    } else if (currentChapter && node.textContent.trim()) {
                        currentChapter.content += this.getElementHTML(node);
                    }
                }
                
                if (currentChapter) {
                    chapters.push(currentChapter);
                }
            }
        } else {
            sections.forEach((section, index) => {
                const titleElement = section.querySelector('title');
                const title = titleElement ? 
                             this.getTextContent(titleElement) : 
                             `Глава ${index + 1}`;
                
                chapters.push({
                    title: title,
                    content: this.getElementHTML(section)
                });
            });
        }
        
        // Если ничего не найдено, создаем одну главу со всем содержимым
        if (chapters.length === 0) {
            chapters.push({
                title: 'Книга', 
                content: this.getElementHTML(body)
            });
        }
        
        return chapters;
    }

    getTextContent(element, selector) {
        const found = selector ? element.querySelector(selector) : element;
        return found ? found.textContent.trim() : '';
    }

    getElementHTML(element) {
        return element.innerHTML || element.textContent || '';
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Помилка читання файлу'));
            reader.readAsText(file, 'UTF-8');
        });
    }

    readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Помилка читання файлу'));
            reader.readAsDataURL(file);
        });
    }

    // UI управление
    updateLibrary() {
        const libraryContent = document.getElementById('libraryContent');
        
        if (this.books.length === 0) {
            libraryContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-book-open"></i>
                    <h3>Додайте свою першу книгу</h3>
                    <p>Щоб почати читання</p>
                    <small>Підтримуються формати: FB2, TXT</small>
                </div>
            `;
        }
        else {
            libraryContent.innerHTML = `
                <div class="books-grid" id="booksGrid"></div>
            `;
            
            this.renderBooks();
        }
    }

    renderBooks() {
        const booksGrid = document.getElementById('booksGrid');
        if (!booksGrid) return; 
        
        booksGrid.innerHTML = this.books.map(book => `
            <div class="book-card" data-book-id="${book.id}">
                <div class="book-cover">
                    ${book.coverImage ? 
                        `<img src="${book.coverImage}" alt="${book.title}">` : 
                        `<div class="default-cover">
                            <i class="fas fa-book"></i>
                        </div>`
                    }
                    <div class="book-info-on-cover">
                        <div class="book-title">${book.title}</div>
                        <div class="book-author">${book.author}</div>
                    </div>
                    <span class="book-progress-text">${Math.round(book.readingProgress)}%</span>
                </div>
                <div class="book-format-badge">${book.fileType.toUpperCase()}</div>
            </div>
        `).join('');
        
        // Добавляем обработчики событий
        booksGrid.querySelectorAll('.book-card').forEach(card => {
            const bookId = card.dataset.bookId;
            const book = this.books.find(b => b.id === bookId);
            
            // Клик для открытия книги
            card.addEventListener('click', () => this.openBook(book));
            
            // Долгое нажатие/правый клик для удаления
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showDeleteModal(book);
            });
            
            // Долгое нажатие на мобильных устройствах
            let pressTimer;
            card.addEventListener('touchstart', (e) => {
                pressTimer = setTimeout(() => {
                    this.showDeleteModal(book);
                }, 1000);
            });
            
            card.addEventListener('touchend', () => {
                clearTimeout(pressTimer);
            });
        });
    }

    async openBook(book) {
        this.currentBook = book;
        this.currentChapter = book.currentChapter || 0;
        this.readingPosition = book.currentPosition || 0;

        this.showReader(); // Show the reader screen first

        if (this.currentBook.fileType === 'epub') {
            // If epubBook and rendition already exist for this book, just display to position
            // Check if the existing epubBook is for the same book ID
            if (this.epubBook && this.epubBook.url === this.currentBook.id && this.rendition) {
                this.rendition.display(this.currentBook.currentPosition || 0);
                this.updateProgressDisplay(this.currentBook.readingProgress);
                this.updateSideMenuForReading();
                this.startRestTimer();
                localStorage.setItem('lastBookId', book.id);
                return; // Exit early if already rendered
            }

            const epubFile = await bookDB.getEpubFile(this.currentBook.id);
            if (epubFile) {
                this.currentBook.epubFile = epubFile;
                const blob = new Blob([epubFile], { type: 'application/epub+zip' });
                
                try {
                    this.epubBook = window.ePub(blob);
                    // Store the book ID with the epubBook instance for later comparison
                    this.epubBook.url = this.currentBook.id; 

                    await this.epubBook.ready;
                    await this.epubBook.locations.generate(this.settings.sectionBreak);

                    this.rendition = this.epubBook.renderTo('bookContent', {
                        width: '100%',
                        height: '100%',
                        manager: 'continuous',
                        flow: 'paginated'
                    });

                    this.rendition.on('relocated', (location) => {
                        this.currentBook.currentChapter = location.start.index;
                        this.currentBook.currentPosition = location.start.percentage;
                        console.log('EPUB relocated event: saved position', this.currentBook.currentPosition);
                        this.saveBooks();
                        this.updateProgressDisplay(location.start.percentage * 100);
                        this.updateSideMenuForReading();
                    });

                    // Display to the saved position immediately after creation
                    console.log('openBook: EPUB - attempting to display to position', this.currentBook.currentPosition || 0);
                    this.rendition.display(this.currentBook.currentPosition || 0);
                    this.updateProgressDisplay(this.currentBook.readingProgress);
                    this.updateSideMenuForReading();
                    this.startRestTimer();

                } catch (epubError) {
                    console.error('Error during Epub.js initialization or rendering:', epubError);
                    this.showNotification(`Error opening EPUB: ${epubError.message || epubError}`);
                    document.getElementById('bookContent').innerHTML = '<p style="text-align: center; color: red;">Failed to render EPUB content.</p>';
                }
            } else {
                this.showNotification('Could not load book content. Please try adding the book again.');
            }
        } else {
            // For non-EPUB books, reset epubBook and rendition
            this.epubBook = null;
            this.rendition = null;
            console.log('openBook: Non-EPUB - loaded currentChapter', this.currentChapter, 'readingPosition', this.readingPosition);
            this.renderBookContent(); // Call renderBookContent for non-EPUBs
            this.updateProgressDisplay(this.currentBook.readingProgress);
            this.updateSideMenuForReading();
            this.startRestTimer();
        }
        localStorage.setItem('lastBookId', book.id);
    }

    showReader() {
        document.getElementById('libraryScreen').classList.remove('active');
        document.getElementById('readerScreen').classList.add('active');
        
        // Show chaptersBtn
        document.getElementById('chaptersBtn').style.display = 'flex'; // Assuming it's a flex container
        document.getElementById('homeBtn').style.display = 'flex';
        
        // Обновляем боковое меню для режима чтения
        this.updateSideMenuForReading();
    }

    showLibrary() {
        document.getElementById('readerScreen').classList.remove('active');
        document.getElementById('libraryScreen').classList.add('active');
        document.getElementById('chaptersBtn').style.display = 'none';
        document.getElementById('homeBtn').style.display = 'none';
        this.closeSideMenu();
        window.scrollTo(0, 0);
        
        // Очищаем обработчики прокрутки
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler);
            window.removeEventListener('resize', this.scrollHandler);
            const readerContent = document.querySelector('.reader-content');
            if (readerContent) {
                readerContent.removeEventListener('scroll', this.scrollHandler);
            }
            this.scrollHandler = null;
        }
        
        // Очищаем observer
        if (this.progressObserver) {
            this.progressObserver.disconnect();
            this.progressObserver = null;
        }
        
        // Очищаем обработчики переключения прогресса
        if (this.progressToggleHandler) {
            const readerContent = document.querySelector('.reader-content');
            if (readerContent) {
                readerContent.removeEventListener('click', this.progressToggleHandler);
                readerContent.removeEventListener('touchend', this.progressToggleHandler);
            }
            this.progressToggleHandler = null;
        }
        
        this.updateLibrary(); // Обновляем библиотеку для отображения актуального прогресса
        
        // Обновляем боковое меню для режима библиотеки
        this.updateSideMenuForLibrary();

        this.stopRestTimer();
        this.releaseWakeLock(); // Add this line
    }

    renderBookContent() {
        const bookContent = document.getElementById('bookContent');
        if (!bookContent) return; 

        if (this.currentBook.fileType === 'epub') {
            // EPUBs are handled in openBook, so just return here
            const nextChapterSection = document.querySelector('.next-chapter-section');
            if (nextChapterSection) nextChapterSection.style.display = 'none';
            return;
        }

        if (!this.currentBook || !this.currentBook.chapters[this.currentChapter]) return; 
        
        const chapter = this.currentBook.chapters[this.currentChapter];
        
        // Проверяем, есть ли следующая глава
        const hasNextChapter = this.currentChapter < this.currentBook.chapters.length - 1;
        const nextChapter = hasNextChapter ? this.currentBook.chapters[this.currentChapter + 1] : null;
        
        let nextChapterButton = '';
        if (hasNextChapter && nextChapter) {
            nextChapterButton = `
                <div class="next-chapter-section">
                    <button id="nextChapterBtn" class="next-chapter-btn">
                        <i class="fas fa-arrow-right"></i>
                        <span>Наступна глава: ${nextChapter.title}</span>
                    </button>
                </div>
            `;
        }
        
        bookContent.innerHTML = `
            <h1>${chapter.title}</h1>
            <div class="chapter-content">${chapter.content}</div>
            ${nextChapterButton}
        `;
        
        // Привязываем обработчик кнопки следующей главы
        if (hasNextChapter) {
            const nextBtn = document.getElementById('nextChapterBtn');
            if (nextBtn) {
                nextBtn.addEventListener('click', () => {
                    this.goToChapter(this.currentChapter + 1);
                });
            }
        }
        
        // Принудительно обновляем стили
        this.applySettings();
        
        // Прокручиваем к сохраненной позиции или в начало главы
        requestAnimationFrame(() => {
            const readerContent = document.querySelector('.reader-content');
            if (readerContent) {
                console.log('renderBookContent: Non-EPUB - attempting to scroll to', this.readingPosition);
                console.log('renderBookContent: Non-EPUB - scrollHeight', readerContent.scrollHeight, 'clientHeight', readerContent.clientHeight);
                readerContent.scrollTo(0, this.readingPosition);
            }
        });
        
        // Отслеживаем прогресс чтения
        this.trackReadingProgress();
        
        // Принудительно обновляем прогресс после рендеринга
        setTimeout(() => {
            this.trackReadingProgress();
        }, 300);
        
        // Добавляем альтернативный способ отслеживания через MutationObserver
        this.setupProgressObserver();
    }

    trackReadingProgress() {
        if (!this.currentBook) return; 

        // Удаляем предыдущие обработчики
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler);
            window.removeEventListener('resize', this.scrollHandler);
            const readerContent = document.querySelector('.reader-content');
            if (readerContent) {
                readerContent.removeEventListener('scroll', this.scrollHandler);
            }
            this.scrollHandler = null;
        }

        const readerContent = document.querySelector('.reader-content');
        if (!readerContent) return;

        // Debounced version of the actual progress tracking logic
        const debouncedTrack = debounce(() => {
            if (!this.currentBook) return;

            const scrollTop = readerContent.scrollTop;
            const windowHeight = readerContent.clientHeight;
            const documentHeight = readerContent.scrollHeight;
            const totalChapters = this.currentBook.chapters.length;

            console.log('Scroll event:', {
                scrollTop,
                windowHeight,
                documentHeight,
                currentChapter: this.currentChapter,
                totalChapters
            });

            // Рассчитываем прогресс текущей главы
            let chapterProgress = 0;

            if (documentHeight <= windowHeight) {
                chapterProgress = 1;
            } else {
                const maxScroll = documentHeight - windowHeight;
                if (maxScroll > 0) {
                    chapterProgress = Math.min(1, Math.max(0, scrollTop / maxScroll));
                }
            }

            // Рассчитываем общий прогресс книги
            const chaptersRead = this.currentChapter;
            const totalProgress = ((chaptersRead + chapterProgress) / totalChapters) * 100;

            console.log('Calculated progress:', {
                chapterProgress,
                chaptersRead,
                totalProgress
            });

            this.updateProgressDisplay(totalProgress);

            // Сохраняем позицию
            this.currentBook.readingProgress = totalProgress;
            this.currentBook.currentPosition = scrollTop;
            console.log('trackReadingProgress: Non-EPUB - saved position', this.currentBook.currentPosition);
            this.saveBooks();
        }, 150); // Debounce by 150ms

        this.scrollHandler = () => {
            debouncedTrack();
        };

        // Добавляем обработчики
        readerContent.addEventListener('scroll', this.scrollHandler, { passive: true });
        window.addEventListener('resize', this.scrollHandler, { passive: true });

        // Вызываем сразу
        this.scrollHandler();

        // Также вызываем с задержкой для надежности
        setTimeout(() => {
            this.scrollHandler();
        }, 100);
    }

    updateProgressDisplay(progress) {
        const progressText = document.getElementById('progressText');
        const chapterInfo = document.getElementById('chapterInfo');
        const chapterPages = document.getElementById('chapterPages');

        if (!this.currentBook) return;

        // Ограничиваем прогресс от 0 до 100
        const clampedProgress = Math.min(100, Math.max(0, progress));
        
        if (progressText) {
            progressText.textContent = Math.round(clampedProgress) + '%';
        }

        // Информация о главе
        const chapter = this.currentBook.chapters[this.currentChapter];
        if (chapter && chapterInfo) {
            chapterInfo.textContent = chapter.title;
            chapterInfo.title = chapter.title; // Tooltip for long titles
        }

        // Расчет страниц в главе
        if (chapterPages) {
            const readerContent = document.querySelector('.reader-content');
            if (readerContent) {
                const contentHeight = readerContent.scrollHeight;
                const windowHeight = readerContent.clientHeight;
                const totalPages = Math.max(1, Math.ceil(contentHeight / windowHeight));
                
                const scrollTop = readerContent.scrollTop;
                let currentPage = Math.max(1, Math.floor(scrollTop / windowHeight) + 1);

                // Коррекция для последней страницы
                if (scrollTop + windowHeight >= contentHeight) {
                    currentPage = totalPages;
                }

                chapterPages.textContent = `(${Math.min(currentPage, totalPages)}/${totalPages})`;
            } else {
                chapterPages.textContent = '';
            }
        }
        
        // Отладочная информация
        console.log('Progress update:', {
            progress: progress,
            clampedProgress: clampedProgress,
            currentChapter: this.currentChapter,
            totalChapters: this.currentBook ? this.currentBook.chapters.length : 0,
            scrollTop: window.pageYOffset || document.documentElement.scrollTop,
            documentHeight: document.documentElement.scrollHeight,
            windowHeight: window.innerHeight
        });
    }

    setupProgressObserver() {
        // Удаляем предыдущий observer
        if (this.progressObserver) {
            this.progressObserver.disconnect();
        }
        
        // Создаем новый observer для отслеживания изменений в DOM
        this.progressObserver = new MutationObserver(() => {
            if (this.currentBook) {
                setTimeout(() => {
                    this.trackReadingProgress();
                }, 100);
            }
        });
        
        // Наблюдаем за изменениями в контенте книги
        const bookContent = document.getElementById('bookContent');
        if (bookContent) {
            this.progressObserver.observe(bookContent, {
                childList: true,
                subtree: true,
                attributes: true
            });
        }
    }

    

    // Настройки
    showSettings() {
        document.getElementById('settingsModal').classList.add('open');
        this.updateSettingsUI();
    }

    hideSettings() {
        document.getElementById('settingsModal').classList.remove('open');
    }

    updateSettingsUI() {
        document.getElementById('fontSizeValue').textContent = this.settings.fontSize + 'px';
        document.getElementById('lineHeightValue').textContent = this.settings.lineHeight.toFixed(1);
        
        // Выделяем текущую тему
        document.querySelectorAll('.theme-option').forEach(option => {
            option.classList.remove('selected');
            if (option.dataset.theme === this.settings.theme) {
                option.classList.add('selected');
            }
        });
    }

    changeFontSize(delta) {
        this.settings.fontSize = Math.max(12, Math.min(32, this.settings.fontSize + delta));
        this.applySettings();
        this.updateSettingsUI();
        this.saveSettings();
    }

    changeLineHeight(delta) {
        this.settings.lineHeight = Math.max(1.0, Math.min(3.0, this.settings.lineHeight + delta));
        this.applySettings();
        this.updateSettingsUI();
        this.saveSettings();
    }

    selectTheme(theme) {
        this.settings.theme = theme;
        this.applySettings();
        this.updateSettingsUI();
        this.saveSettings();
    }

    applySettings() {
        const bookContent = document.querySelector('.book-content');
        if (bookContent) {
            bookContent.style.fontSize = this.settings.fontSize + 'px';
            bookContent.style.lineHeight = this.settings.lineHeight;
        }
        
        document.documentElement.setAttribute('data-theme', this.settings.theme);
    }

    // Главы теперь в боковом меню

    goToChapter(chapterIndex) {
        if (!this.currentBook || !this.currentBook.chapters[chapterIndex]) return; 
        
        this.currentChapter = chapterIndex;
        this.readingPosition = 0;
        
        if (this.currentBook) {
            this.currentBook.currentChapter = chapterIndex;
            this.currentBook.currentPosition = 0;
        }
        
        this.renderBookContent();
        this.updateSideMenuForReading(); // Обновляем боковое меню
        this.saveBooks();
    }

    // Удаление книг
    showDeleteModal(book) {
        this.bookToDelete = book;
        document.getElementById('deleteModal').classList.add('open');
    }

    hideDeleteModal() {
        document.getElementById('deleteModal').classList.remove('open');
        this.bookToDelete = null;
    }

    async confirmDelete() {
        if (this.bookToDelete) {
            if (this.bookToDelete.fileType === 'epub') {
                await bookDB.deleteEpubFile(this.bookToDelete.id);
            }
            this.books = this.books.filter(book => book.id !== this.bookToDelete.id);
            this.saveBooks();
            this.updateLibrary();
            
            // Если удаляем текущую книгу, возвращаемся в библиотеку
            if (this.currentBook && this.currentBook.id === this.bookToDelete.id) {
                this.showLibrary();
                this.currentBook = null;
            }
        }
        
        this.hideDeleteModal();
    }

    // Боковое меню
    toggleSideMenu() {
        document.getElementById('sideMenu').classList.toggle('open');
        document.getElementById('overlay').classList.toggle('visible');
    }

    closeSideMenu() {
        document.getElementById('sideMenu').classList.remove('open');
        document.getElementById('overlay').classList.remove('visible');
    }

    updateSideMenuForLibrary() {
        const menuTitle = document.getElementById('menuTitle');
        const menuContent = document.getElementById('menuContent');
        
        menuTitle.textContent = 'Мої книги';
        menuContent.innerHTML = `
            <button id="addBookBtn" class="add-book-btn">
                <i class="fas fa-plus"></i>
                <span>Додати книгу</span>
            </button>
            <div id="booksList" class="books-list">
                <!-- Список книг будет добавлен динамически -->
            </div>
        `;
        
        // Перепривязываем события
        document.getElementById('addBookBtn').addEventListener('click', () => this.openFileDialog());
    }

    updateSideMenuForReading() {
        const menuTitle = document.getElementById('menuTitle');
        const menuContent = document.getElementById('menuContent');
        
        menuTitle.textContent = 'Глави';
        menuContent.innerHTML = `
            <div id="chaptersList" class="chapters-list">
                <!-- Список глав будет добавлен динамически -->
            </div>
        `;
        
        // Заполняем список глав
        this.renderChaptersInSideMenu();
    }

    renderChaptersInSideMenu() {
        if (!this.currentBook) return; 
        
        const chaptersList = document.getElementById('chaptersList');
        if (!chaptersList) return; 
        
        chaptersList.innerHTML = this.currentBook.chapters.map((chapter, index) => `
            <div class="chapter-item ${index === this.currentChapter ? 'current' : ''}" data-chapter="${index}">
                <div class="chapter-title">${chapter.title}</div>
                <div class="chapter-progress">${index === this.currentChapter ? 'Поточна глава' : ''}</div>
            </div>
        `).join('');
        
        // Добавляем обработчики
        chaptersList.querySelectorAll('.chapter-item').forEach(item => {
            item.addEventListener('click', () => {
                const chapterIndex = parseInt(item.dataset.chapter);
                this.goToChapter(chapterIndex);
                this.closeSideMenu();
            });
        });
    }

    // Утилиты
    openFileDialog() {
        document.getElementById('fileInput').click();
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    hideAllModals() {
        document.body.classList.remove('modal-open');
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('open');
        });
    }

    showNotification(message) {
        const notification = document.getElementById('notification');
        const messageElement = document.getElementById('notificationMessage');

        if (notification && messageElement) {
            messageElement.textContent = message;
            notification.classList.add('show');

            setTimeout(() => {
                notification.classList.remove('show');
            }, 3000);
        }
    }

    // Сохранение и загрузка
    saveBooks() {
        localStorage.setItem('bookReader_books', JSON.stringify(this.books));
    }

    loadBooks() {
        const saved = localStorage.getItem('bookReader_books');
        if (saved) {
            try {
                this.books = JSON.parse(saved);
            } catch (e) {
                console.error('Помилка при завантаженні книг:', e);
                this.books = [];
            }
        }
    }

    saveSettings() {
        localStorage.setItem('bookReader_settings', JSON.stringify(this.settings));
    }

    loadSettings() {
        const saved = localStorage.getItem('bookReader_settings');
        if (saved) {
            try {
                this.settings = { ...this.settings, ...JSON.parse(saved) };
            } catch (e) {
                console.error('Помилка при завантаженні налаштувань:', e);
            }
        }
    }

    updateUI() {
        this.updateLibrary();
        this.updateSideMenuForLibrary();
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new BookReader();
});

// Обработка ошибок
window.addEventListener('error', (e) => {
    console.error('Помилка програми:', e.error);
});

// Предотвращение потери данных при закрытии
window.addEventListener('beforeunload', (e) => {
    // Данные уже сохраняются автоматически при изменениях
});ry {
                this.settings = { ...this.settings, ...JSON.parse(saved) };
            } catch (e) {
                console.error('Помилка при завантаженні налаштувань:', e);
            }
        }
    }

    updateUI() {
        this.updateLibrary();
        this.updateSideMenuForLibrary();
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new BookReader();
});

// Обработка ошибок
window.addEventListener('error', (e) => {
    console.error('Помилка програми:', e.error);
});

// Предотвращение потери данных при закрытии
window.addEventListener('beforeunload', (e) => {
    // Данные уже сохраняются автоматически при изменениях
});