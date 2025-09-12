// Book Reader - JavaScript функциональность

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
    }

    // Управление книгами
    async handleFileUpload(event) {
        const files = Array.from(event.target.files);
        
        for (const file of files) {
            try {
                const book = await this.parseBook(file);
                if (book) {
                    this.books.push(book);
                }
            } catch (error) {
                console.error('Ошибка при загрузке книги:', error);
                alert(`Ошибка при загрузке файла ${file.name}`);
            }
        }
        
        this.saveBooks();
        this.updateLibrary();
        this.closeSideMenu();
        event.target.value = '';
    }

    async parseBook(file) {
        const fileExtension = file.name.split('.').pop().toLowerCase();
        
        switch (fileExtension) {
            case 'fb2':
                return await this.parseFB2(file);
            case 'txt':
                return await this.parseTXT(file);
            case 'epub':
                return await this.parseEPUB(file);
            default:
                throw new Error('Неподдерживаемый формат файла');
        }
    }

    async parseFB2(file) {
        const text = await this.readFileAsText(file);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');
        
        // Извлекаем метаданные
        const title = this.getTextContent(xmlDoc, 'book-title') || 
                     this.getTextContent(xmlDoc, 'title') || 
                     file.name.replace('.fb2', '');
        const author = this.getTextContent(xmlDoc, 'first-name') + ' ' + 
                      this.getTextContent(xmlDoc, 'last-name') || 
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
                    const base64 = binaryElement.textContent;
                    coverImage = `data:image/jpeg;base64,${base64}`;
                }
            }
        }
        
        // Извлекаем содержимое
        const body = xmlDoc.querySelector('body');
        if (!body) throw new Error('Не удалось найти содержимое книги');
        
        const chapters = this.extractChapters(body);
        
        return {
            id: this.generateId(),
            title: title.trim(),
            author: author.trim(),
            coverImage,
            chapters,
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
        const lines = text.split('\n');
        
        // Простое разделение на главы по заголовкам
        const chapters = [];
        let currentChapter = { title: 'Глава 1', content: '' };
        
        for (const line of lines) {
            if (line.trim().match(/^(Глава|Chapter|Розділ)\s+\d+/i) || 
                line.trim().match(/^\d+\.\s+/) ||
                (line.trim().length > 0 && line.trim().length < 100 && 
                 line.trim().toUpperCase() === line.trim() && 
                 !line.includes('.'))) {
                
                if (currentChapter.content.trim()) {
                    chapters.push(currentChapter);
                }
                currentChapter = { title: line.trim(), content: '' };
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
            title: file.name.replace('.txt', ''),
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

    async parseEPUB(file) {
        // Упрощенная версия для EPUB (требует дополнительной библиотеки для полной поддержки)
        throw new Error('EPUB формат пока не поддерживается. Используйте FB2 или TXT файлы.');
    }

    extractChapters(body) {
        const chapters = [];
        const sections = body.querySelectorAll('section, title');
        
        let currentChapter = null;
        
        for (const element of sections) {
            if (element.tagName === 'title') {
                if (currentChapter) {
                    chapters.push(currentChapter);
                }
                currentChapter = {
                    title: this.getTextContent(element) || 'Глава',
                    content: ''
                };
            } else if (currentChapter) {
                const content = this.getElementHTML(element);
                currentChapter.content += content;
            }
        }
        
        if (currentChapter) {
            chapters.push(currentChapter);
        }
        
        return chapters.length > 0 ? chapters : [{ title: 'Книга', content: this.getElementHTML(body) }];
    }

    getTextContent(element, selector) {
        const found = selector ? element.querySelector(selector) : element;
        return found ? found.textContent.trim() : '';
    }

    getElementHTML(element) {
        return element.innerHTML || element.textContent;
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file, 'UTF-8');
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
                </div>
            `;
        } else {
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
                    <div class="book-progress">
                        <div class="book-progress-fill" style="width: ${book.readingProgress}%"></div>
                    </div>
                </div>
                <div class="book-info">
                    <div class="book-title">${book.title}</div>
                    <div class="book-author">${book.author}</div>
                </div>
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

    openBook(book) {
        this.currentBook = book;
        this.currentChapter = book.currentChapter || 0;
        this.readingPosition = book.currentPosition || 0;
        
        this.showReader();
        this.renderBookContent();
        
        // Рассчитываем прогресс с учетом прочитанных глав
        const totalChapters = book.chapters.length;
        const chaptersRead = this.currentChapter;
        const currentChapterProgress = 0; // Начинаем с начала главы
        const totalProgress = ((chaptersRead + currentChapterProgress) / totalChapters) * 100;
        
        // Устанавливаем начальный прогресс
        this.updateProgressDisplay(totalProgress);
        
        // Сохраняем ID последней книги
        localStorage.setItem('lastBookId', book.id);
    }

    showReader() {
        document.getElementById('libraryScreen').classList.remove('active');
        document.getElementById('readerScreen').classList.add('active');
        
        // Обновляем боковое меню для режима чтения
        this.updateSideMenuForReading();
    }

    showLibrary() {
        document.getElementById('readerScreen').classList.remove('active');
        document.getElementById('libraryScreen').classList.add('active');
        this.closeSideMenu();
        
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
        
        // Обновляем боковое меню для режима библиотеки
        this.updateSideMenuForLibrary();
    }

    renderBookContent() {
        if (!this.currentBook || !this.currentBook.chapters[this.currentChapter]) return;
        
        const chapter = this.currentBook.chapters[this.currentChapter];
        const bookContent = document.getElementById('bookContent');
        
        if (!bookContent) return;
        
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
        
        // Прокручиваем к сохраненной позиции
        if (this.readingPosition > 0) {
            setTimeout(() => {
                window.scrollTo(0, this.readingPosition);
            }, 100);
        }
        
        // Отслеживаем прогресс чтения
        this.trackReadingProgress();
        
        // Принудительно обновляем прогресс после рендеринга
        setTimeout(() => {
            this.trackReadingProgress();
        }, 300);
        
        // Добавляем альтернативный способ отслеживания через MutationObserver
        this.setupProgressObserver();
        
        // Добавляем обработчик для скрытия/показа полосы прогресса
        this.addProgressToggleHandler();
    }

    trackReadingProgress() {
        if (!this.currentBook) return;
        
        // Удаляем предыдущие обработчики
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler);
            window.removeEventListener('resize', this.scrollHandler);
        }
        
        this.scrollHandler = () => {
            if (!this.currentBook) return;
            
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;
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
                // Если контент помещается на экран, считаем главу полностью прочитанной
                chapterProgress = 1;
            } else {
                // Рассчитываем прогресс прокрутки внутри главы
                const maxScroll = documentHeight - windowHeight;
                if (maxScroll > 0) {
                    chapterProgress = Math.min(1, Math.max(0, scrollTop / maxScroll));
                } else {
                    chapterProgress = 1;
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
            this.saveBooks();
        };
        
        // Добавляем обработчики
        window.addEventListener('scroll', this.scrollHandler, { passive: true });
        window.addEventListener('resize', this.scrollHandler, { passive: true });
        
        // Также добавляем обработчик для контейнера чтения
        const readerContent = document.querySelector('.reader-content');
        if (readerContent) {
            readerContent.addEventListener('scroll', this.scrollHandler, { passive: true });
        }
        
        // Вызываем сразу
        this.scrollHandler();
        
        // Также вызываем с задержкой для надежности
        setTimeout(() => {
            this.scrollHandler();
        }, 100);
    }

    updateProgressDisplay(progress) {
        const progressText = document.getElementById('progressText');
        const progressFill = document.getElementById('progressFill');
        
        // Ограничиваем прогресс от 0 до 100
        const clampedProgress = Math.min(100, Math.max(0, progress));
        
        if (progressText) progressText.textContent = Math.round(clampedProgress) + '%';
        if (progressFill) progressFill.style.width = clampedProgress + '%';
        
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

    addProgressToggleHandler() {
        const readerContent = document.querySelector('.reader-content');
        const readerFooter = document.querySelector('.reader-footer');
        
        if (!readerContent || !readerFooter) return;
        
        // Удаляем предыдущие обработчики
        if (this.progressToggleHandler) {
            readerContent.removeEventListener('click', this.progressToggleHandler);
            readerContent.removeEventListener('touchend', this.progressToggleHandler);
        }
        
        // Флаг для предотвращения двойного срабатывания
        let isTouching = false;
        let touchStartTime = 0;
        
        // Обработчик начала касания
        const touchStartHandler = (e) => {
            isTouching = true;
            touchStartTime = Date.now();
        };
        
        // Обработчик окончания касания/клика
        this.progressToggleHandler = (e) => {
            // Предотвращаем срабатывание на кнопках и ссылках
            if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.next-chapter-btn')) {
                return;
            }
            
            // Для touch событий проверяем, что это был короткий тап
            if (e.type === 'touchend') {
                if (!isTouching || (Date.now() - touchStartTime) > 300) {
                    return;
                }
                isTouching = false;
            }
            
            // Предотвращаем двойное срабатывание
            e.preventDefault();
            e.stopPropagation();
            
            // Переключаем видимость полосы прогресса
            readerFooter.classList.toggle('hidden');
        };
        
        // Добавляем обработчики
        readerContent.addEventListener('touchstart', touchStartHandler, { passive: true });
        readerContent.addEventListener('touchend', this.progressToggleHandler, { passive: false });
        readerContent.addEventListener('click', this.progressToggleHandler, { passive: false });
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
        document.getElementById('lineHeightValue').textContent = this.settings.lineHeight;
        
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

    confirmDelete() {
        if (this.bookToDelete) {
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
    }

    closeSideMenu() {
        document.getElementById('sideMenu').classList.remove('open');
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
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('open');
        });
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
                console.error('Ошибка при загрузке книг:', e);
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
                console.error('Ошибка при загрузке настроек:', e);
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
    console.error('Ошибка приложения:', e.error);
});

// Предотвращение потери данных при закрытии
window.addEventListener('beforeunload', (e) => {
    // Данные уже сохраняются автоматически при изменениях
});

