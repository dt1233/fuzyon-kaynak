const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const db = require('./db');


const slugifyTr = (text) => {
    if (!text) return '';
    const trMap = {
        'ç': 'c', 'ğ': 'g', 'ş': 's', 'ü': 'u', 'ı': 'i', 'ö': 'o',
        'Ç': 'c', 'Ğ': 'g', 'Ş': 's', 'Ü': 'u', 'İ': 'i', 'Ö': 'o'
    };
    let slug = text;
    for (let key in trMap) {
        slug = slug.replace(new RegExp(key, 'g'), trMap[key]);
    }
    return slug.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
};

const app = express();
const PORT = process.env.PORT || 3000;

// Setup static files and view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Locals
app.locals.renderIconClass = function(iconStr, defaultIcon) {
    let icon = iconStr || defaultIcon;
    if (icon.startsWith('fa-solid') || icon.startsWith('fa-brands') || icon.startsWith('fa-regular')) {
        return icon;
    }
    return 'fa-solid ' + icon;
};

// Middleware to parse request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session setup for Admin Panel (Serverless uyumlu)
app.use(cookieSession({
    name: 'session',
    keys: ['akfuzyon_secret_key_123'],
    maxAge: 24 * 60 * 60 * 1000 // 1 day
}));

// Multer setup for image uploads
const { put } = require('@vercel/blob');
const storage = process.env.POSTGRES_URL ? multer.memoryStorage() : multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const uploadInstance = multer({ storage: storage });

const uploadToBlob = async (req, res, next) => {
    if (!process.env.POSTGRES_URL) {
        if (req.file) req.file.url = req.file.url;
        if (req.files) req.files.forEach(f => f.url = f.url);
        return next();
    }
    try {
        if (req.file) {
            const blob = await put(Date.now() + '-' + req.file.originalname, req.file.buffer, { access: 'public', token: process.env.BLOB_READ_WRITE_TOKEN });
            req.file.url = blob.url;
        }
        if (req.files) {
            for (let i = 0; i < req.files.length; i++) {
                const blob = await put(Date.now() + '-' + req.files[i].originalname, req.files[i].buffer, { access: 'public', token: process.env.BLOB_READ_WRITE_TOKEN });
                req.files[i].url = blob.url;
            }
        }
        next();
    } catch (err) {
        console.error("Blob upload error:", err);
        res.status(500).send(`<h2>Görsel Yükleme Hatası (Vercel Blob)</h2><p>Hata Detayı: <b>${err.message}</b></p><p>Çözüm: Vercel panelinizde <b>Storage > Blob</b> oluşturduğunuzdan ve <b>BLOB_READ_WRITE_TOKEN</b> anahtarının Environment Variables kısmında olduğundan emin olun. Ayarı yaptıktan sonra sitenizi Vercel'den <b>Redeploy</b> (Yeniden Kur) yapmanız gerekir.</p><br><a href="javascript:history.back()">Geri Dön</a>`);
    }
};

const upload = {
    single: (name) => (req, res, next) => uploadInstance.single(name)(req, res, (err) => err ? next(err) : uploadToBlob(req, res, next)),
    array: (name, maxCount) => (req, res, next) => uploadInstance.array(name, maxCount)(req, res, (err) => err ? next(err) : uploadToBlob(req, res, next)),
    any: () => (req, res, next) => uploadInstance.any()(req, res, (err) => err ? next(err) : uploadToBlob(req, res, next))
};

// Middleware to inject settings into all views
app.use(async (req, res, next) => {
    try {
        const settings = await db.getSettings();
        res.locals.settings = settings;
        res.locals.slugs = {
            home: '',
            about: slugifyTr(settings.nav_about || 'Hakkımızda'),
            services: slugifyTr(settings.nav_services || 'Hizmetlerimiz'),
            products: slugifyTr(settings.nav_products || 'Ürünler'),
            references: slugifyTr(settings.nav_references || 'Referanslar'),
            contact: slugifyTr(settings.nav_contact || 'İletişim')
        };
        next();
    } catch (err) {
        console.error(err);
        res.locals.settings = {};
        res.locals.slugs = {};
        next();
    }
});

// Admin Authentication Middleware
const requireAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/admin/login');
    }
};


// Traffic Analyzer Middleware
app.use((req, res, next) => {
    if (!req.path.startsWith('/admin') && !req.path.startsWith('/uploads') && !req.path.match(/\.(css|js|jpg|jpeg|png|gif|ico|woff|woff2|ttf|svg)$/i)) {
        const today = new Date().toISOString().split('T')[0];
        db.run("UPDATE page_views SET views = views + 1 WHERE date = ?", [today], function(err) {
            if (this && this.changes === 0) {
                db.run("INSERT INTO page_views (date, views) VALUES (?, 1)", [today], () => {});
            }
        });
    }
    next();
});


// ============================================
// API ROUTES
// ============================================


app.post('/api/chatbot/ask', (req, res) => {
    const rawUserMessage = (req.body.message || '').toLowerCase().trim();
    // Normalize to collapse repeating characters: "selaaaaaam" -> "selam", "teşekkürler" -> "teşekürler"
    const normalizeStr = (str) => str.replace(/(.)\1+/g, '$1');
    const userMessage = normalizeStr(rawUserMessage);
    
    // 1. Generic Conversational Responses (Hardcoded)
    const genericResponses = [
        {
            keywords: ['merhaba', 'selam', 'hey', 'günaydın', 'iyi günler', 'iyi akşamlar', 'iyi geceler', 'selamlar', 'merhabalar'],
            answer: 'Merhaba! Ak Füzyon sanal asistanı olarak size yardımcı olmaktan mutluluk duyarım. Size nasıl destek olabilirim?'
        },
        {
            keywords: ['nasılsın', 'napıyorsun', 'ne haber', 'naber', 'nasıl gidiyor', 'hayat nasıl', 'nasılsınız', 'ne yapıyorsun'],
            answer: 'Çok teşekkür ederim, harikayım! Ben bir yapay zeka asistanıyım, hiç yorulmam ve her zaman yardıma hazırım. Siz nasılsınız, işler nasıl gidiyor?'
        },
        {
            keywords: ['iyiyim', 'iyi', 'şükür', 'süper', 'harika', 'fena değil', 'idare eder', 'bomba gibiyim', 'teşekkürler iyiyim', 'sağol iyiyim'],
            answer: 'Bunu duyduğuma çok sevindim! Enerjiniz harika. Peki projelerinizle veya Ak Füzyon ürünleriyle ilgili size yardımcı olabileceğim bir konu var mı?'
        },
        {
            keywords: ['kötüyüm', 'iyi değilim', 'canım sıkkın', 'yoruldum', 'hastayım', 'moralim bozuk', 'canım sıkıldı'],
            answer: 'Bunu duyduğuma üzüldüm... Bazen işler yorucu olabilir. Umarım en kısa sürede her şey yoluna girer. Belki işinizi kolaylaştıracak teknik bir çözüm bularak yükünüzü biraz hafifletebilirim. Size nasıl destek olabilirim?'
        },
        {
            keywords: ['sen kimsin', 'kiminlesin', 'adın ne', 'ismin ne', 'robot musun', 'yapay zeka mısın', 'nesin sen', 'insan mısın'],
            answer: 'Ben Ak Füzyon için özel olarak geliştirilmiş akıllı bir sanal asistanım. İnsan değilim ama size bir insan kadar sıcak ve hızlı destek verebilmek için tasarlandım!'
        },
        {
            keywords: ['teşekkürler', 'sağ ol', 'teşekkür ederim', 'eyvallah', 'harikasın', 'çok iyi', 'süpersin', 'teşekkür'],
            answer: 'Rica ederim, ne demek! Size yardımcı olabildiysem ne mutlu bana. Başka sormak istediğiniz bir şey olursa ben buralardayım.'
        },
        {
            keywords: ['görüşürüz', 'hoşçakal', 'baybay', 'kendine iyi bak', 'güle güle', 'sonra görüşürüz', 'iyi çalışmalar'],
            answer: 'Görüşmek üzere! İyi çalışmalar dilerim. Ak Füzyon olarak her zaman yanınızdayız.'
        },
        {
            keywords: ['şaka yap', 'bana bir şaka yap', 'fıkra anlat', 'komik bir şey söyle', 'güldür beni'],
            answer: 'Hmm... İki boru yolda karşılaşıyorlar. Biri diğerine "Ne haber?" diyor, diğeri "Nasıl olsun, aynı tas aynı flanş!" diyor. 😄 Sanal bir asistan olarak espri yeteneğim bu kadar, umarım gülümsetebilmişimdir!'
        },
        {
            keywords: ['yaşın kaç', 'kaç yaşındasın', 'nerelisin', 'nerede yaşıyorsun'],
            answer: 'Ben dijital bir asistanım, bu yüzden yaşım yok ve doğrudan Ak Füzyon sunucularında yaşıyorum. Ama şirketimiz Malatya, Türkiye merkezlidir!'
        },
        {
            keywords: ['neler yapabiliyorsun', 'bana nasıl yardımcı olabilirsin', 'ne işe yararsın', 'ne biliyorsun'],
            answer: 'Ak Füzyon ürünleri, çalışma saatlerimiz, iletişim bilgilerimiz veya teknik süreçlerimizle ilgili aklınıza takılan sorulara anında yanıt verebilirim. Siz sorun, ben yanıtlayayım!'
        },
        {
            keywords: ['seni seviyorum', 'çok tatlısın', 'seviliyorsun', 'aşıksın', 'cansın'],
            answer: 'Aww, çok naziksiniz! 😊 Benim kalbim yok ama kodlarımda size yardım etme aşkı var!'
        }
    ];

    // Add some extra keywords dynamically to handle edge cases
    genericResponses[1].keywords.push('iyi misin');
    genericResponses[3].keywords.push('kötü');

    let bestGenericMatch = null;
    let maxGenericScore = 0;

    genericResponses.forEach(gr => {
        gr.keywords.forEach(kw => {
            const words = kw.split(' ').filter(w => w);
            const userWords = userMessage.split(/[\s,.'?!]+/).filter(x => x);
            
            if (words.length > 0 && words.every(w => {
                const nw = normalizeStr(w);
                return userWords.some(uw => nw.length >= 3 ? uw.includes(nw) : uw === nw);
            })) {
                if (words.length > maxGenericScore) {
                    maxGenericScore = words.length;
                    bestGenericMatch = gr.answer;
                }
            }
        });
    });

    if (bestGenericMatch) {
        return res.json({ answer: bestGenericMatch });
    }

    // 2. Business/Theoretical Responses (Database)
    db.all("SELECT * FROM chatbot_qa", [], (err, qas) => {
        if (err) return res.status(500).json({ answer: 'Sunucu hatası oluştu.' });
        
        let matches = [];
        let maxScore = 0;
        
        qas.forEach(qa => {
            const keywordPhrases = qa.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
            
            let bestPhraseScore = 0;
            keywordPhrases.forEach(phrase => {
                const words = phrase.split(' ').filter(w => w);
                const userWords = userMessage.split(/[\s,.'?!]+/).filter(x => x);
                
                if (words.length > 0 && words.every(w => {
                    const nw = normalizeStr(w);
                    // 3 karakterden uzunsa kelime icinde gecmesine izin ver (Turkce ekler icin), kisaysa tam eslesme ara
                    return userWords.some(uw => nw.length >= 3 ? uw.includes(nw) : uw === nw);
                })) {
                    if (words.length > bestPhraseScore) {
                        bestPhraseScore = words.length;
                    }
                }
            });
            
            if (bestPhraseScore > 0) {
                matches.push({ qa, score: bestPhraseScore });
                if (bestPhraseScore > maxScore) {
                    maxScore = bestPhraseScore;
                }
            }
        });
        
        // Sadece en yüksek puana sahip eşleşmeleri al
        const topMatches = matches.filter(m => m.score === maxScore);
        
        if (topMatches.length === 1) {
            // Tek kesin eşleşme varsa doğrudan cevabı ver
            res.json({ answer: topMatches[0].qa.answer });
        } else if (topMatches.length > 1) {
            // Birden fazla eşleşme varsa kullanıcıya seçenek sun
            let optionsHtml = topMatches.map(m => `<li><a href="#" class="chatbot-link" onclick="document.querySelector('.chatbot-input').value='${m.qa.question}'; document.querySelector('.chatbot-form').dispatchEvent(new Event('submit', {cancelable: true})); return false;">${m.qa.question}</a></li>`).join('');
            let suggestionResponse = `Bu konuyla ilgili birden fazla kayıt buldum. Lütfen hangisini sormak istediğinizi seçin:<br><ul style="margin-top: 10px; padding-left: 20px;">${optionsHtml}</ul>`;
            res.json({ answer: suggestionResponse });
        } else {
            res.json({ answer: 'Hmm, bu konuda ne diyeceğimi tam olarak bilemedim 😊 Ben Ak Füzyon için geliştirilmiş teknik bir sanal asistanım ve halen öğrenme aşamasındayım. İsterseniz konuyu bildiğim yerlere çekelim; size ürünlerimiz, fiyatlarımız veya hizmetlerimiz hakkında seve seve yardımcı olabilirim. Ne dersiniz?' });
        }
    });
});

app.post('/api/quote', (req, res) => {
    const { first_name, last_name, email, phone, products } = req.body;
    let productsStr = '';
    if (Array.isArray(products)) {
        productsStr = products.join(', ');
    } else if (products) {
        productsStr = products;
    }
    const stmt = db.prepare("INSERT INTO quotes (first_name, last_name, email, phone, products) VALUES (?, ?, ?, ?, ?)");
    stmt.run(first_name, last_name, email, phone, productsStr, function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, error: 'Bir hata oluştu.' });
        }
        res.json({ success: true, message: 'Teklif talebiniz başarıyla alınmıştır. Mühendislerimiz en kısa sürede sizinle iletişime geçecektir.' });
    });
});

app.post('/api/contact', (req, res) => {
    const { fullname, email, phone, subject, message } = req.body;
    const stmt = db.prepare("INSERT INTO messages (fullname, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)");
    stmt.run(fullname, email, phone, subject, message, function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, error: 'Bir hata oluştu.' });
        }
        res.json({ success: true, message: 'Mesajınız başarıyla iletildi.' });
    });
});

// ============================================
// FRONTEND ROUTES
// ============================================

// Maintenance Mode Middleware
app.use((req, res, next) => {
    const isMaintenance = res.locals.settings && res.locals.settings.maintenance_mode_active === 'true';
    const isAdminArea = req.path.startsWith('/admin');
    const isStaticAsset = req.path.startsWith('/css') || req.path.startsWith('/js') || req.path.startsWith('/images') || req.path.startsWith('/uploads');
    
    if (isMaintenance && !isAdminArea && !isStaticAsset && !req.session.userId) {
        return res.render('maintenance', { settings: res.locals.settings });
    }
    next();
});


app.get('/teklif-al', (req, res) => {
    if (res.locals.settings && res.locals.settings.page_quote_active === 'false') return res.redirect('/');
    db.all("SELECT * FROM categories ORDER BY name ASC", [], (err, categories) => {
        if (err) categories = [];
        res.render('teklif-al', { page: 'teklif-al', categories });
    });
});

app.get('/', (req, res) => {
    res.render('index', { page: 'home' });
});

app.get('/:slug', (req, res, next) => {
    if (req.path.startsWith('/admin') || req.path.startsWith('/css') || req.path.startsWith('/js') || req.path.startsWith('/images') || req.path.startsWith('/uploads')) return next();
    
    const slug = req.params.slug;
    const slugs = res.locals.slugs || {};
    
    if (slug === slugs.about) {
        if (res.locals.settings && res.locals.settings.page_about_active === 'false') return res.redirect('/');
        return res.render('hakkimizda', { page: 'hakkimizda' });
    }
    if (slug === slugs.services) {
        if (res.locals.settings && res.locals.settings.page_services_active === 'false') return res.redirect('/');
        return res.render('hizmetler', { page: 'hizmetler' });
    }
    if (slug === slugs.references) {
        if (res.locals.settings && res.locals.settings.page_references_active === 'false') return res.redirect('/');
        db.all("SELECT * FROM references_table ORDER BY created_at DESC", (err, references) => {
            db.all("SELECT * FROM certificates ORDER BY created_at DESC", (err2, certificates) => {
                return res.render('referanslar', { page: 'referanslar', references: references || [], certificates: certificates || [] });
            });
        });
        return;
    }
    if (slug === slugs.contact) {
        if (res.locals.settings && res.locals.settings.page_contact_active === 'false') return res.redirect('/');
        return res.render('iletisim', { page: 'iletisim' });
    }
    
    if (slug === slugs.products) {
        if (res.locals.settings && res.locals.settings.page_products_active === 'false') return res.redirect('/');
        const categorySlug = req.query.kategori;
        db.all("SELECT * FROM categories", (err, categories) => {
            if (err) return res.status(500).send("Database error");
            
            const page = parseInt(req.query.page) || 1;
            const limit = 12;
            const offset = (page - 1) * limit;

            let countQuery = "SELECT COUNT(*) as total FROM products LEFT JOIN categories ON products.category_id = categories.id";
            let dataQuery = "SELECT products.*, categories.name as category_name FROM products LEFT JOIN categories ON products.category_id = categories.id";
            let params = [];
            
            if (categorySlug) {
                countQuery += " WHERE categories.slug = ?";
                dataQuery += " WHERE categories.slug = ?";
                params.push(categorySlug);
            }
            
            dataQuery += " LIMIT ? OFFSET ?";
            const dataParams = [...params, limit, offset];

            db.get(countQuery, params, (err, countResult) => {
                const totalProducts = countResult ? countResult.total : 0;
                const totalPages = Math.ceil(totalProducts / limit);

                db.all(dataQuery, dataParams, (err, products) => {
                    if (err) return res.status(500).send("Database error");
                    res.render('urunler', { 
                        page: 'urunler', 
                        categories: categories, 
                        products: products,
                        activeCategory: categorySlug || null,
                        currentPage: page,
                        totalPages: totalPages
                    });
                });
            });
        });
        return;
    }
    
    if (slug === (slugs.gallery || 'galeri')) {
        if (res.locals.settings && res.locals.settings.page_gallery_active === 'false') return res.redirect('/');
        db.all("SELECT * FROM gallery ORDER BY created_at DESC", (err, gallery) => {
            if (err) gallery = [];
            return res.render('galeri', { page: 'galeri', gallery });
        });
        return;
    }
    
    if (slug === (slugs.blog || 'blog')) {
        if (res.locals.settings && res.locals.settings.page_blog_active === 'false') return res.redirect('/');
        db.all("SELECT * FROM blogs ORDER BY created_at DESC", (err, blogs) => {
            if (err) blogs = [];
            return res.render('blog', { page: 'blog', blogs });
        });
        return;
    }
    
    next();
});

app.get('/:slug/:product_slug', (req, res, next) => {
    if (req.path.startsWith('/admin') || req.path.startsWith('/css') || req.path.startsWith('/js') || req.path.startsWith('/images') || req.path.startsWith('/uploads')) return next();
    
    const slug = req.params.slug;
    const slugs = res.locals.slugs || {};
    
    if (slug === slugs.products) {
        const productSlug = req.params.product_slug;
        db.get("SELECT products.*, categories.name as category_name, categories.slug as category_slug FROM products LEFT JOIN categories ON products.category_id = categories.id WHERE products.slug = ?", [productSlug], (err, product) => {
            if (err) return res.status(500).send("Database error");
            if (!product) return res.status(404).send("Ürün bulunamadı");
            
            let techTable = [];
            if (product.tech_table_json) {
                try {
                    techTable = JSON.parse(product.tech_table_json);
                } catch (e) {
                    console.error("Tech table parse error", e);
                }
            }
            
            res.render('urun-detay', { 
                page: 'urunler',
                product: product,
                techTable: techTable
            });
        });
        return;
    }
    
    if (slug === (slugs.blog || 'blog')) {
        if (res.locals.settings && res.locals.settings.page_blog_active === 'false') return res.redirect('/');
        const blogSlug = req.params.product_slug;
        db.get("SELECT * FROM blogs WHERE slug = ?", [blogSlug], (err, blog) => {
            if (err) return res.status(500).send("Database error");
            if (!blog) return res.status(404).send("Blog bulunamadı");
            
            // Increment view count
            db.run("UPDATE blogs SET views = views + 1 WHERE id = ?", [blog.id]);
            blog.views += 1;
            
            res.render('blog_detail', { 
                page: 'blog',
                blog: blog
            });
        });
        return;
    }
    
    next();
});

// ============================================
// ADMIN ROUTES
// ============================================

app.get('/admin', (req, res) => {
    res.redirect('/admin/dashboard');
});

app.get('/admin/login', (req, res) => {
    if (req.session.userId) return res.redirect('/admin/dashboard');
    res.render('admin/login', { error: null, layout: false });
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) return res.render('admin/login', { error: 'Giriş hatası', layout: false });
        if (!user) return res.render('admin/login', { error: 'Geçersiz kullanıcı adı', layout: false });
        
        if (bcrypt.compareSync(password, user.password)) {
            req.session.userId = user.id;
            req.session.username = user.username;
            res.redirect('/admin/dashboard');
        } else {
            res.render('admin/login', { error: 'Geçersiz şifre', layout: false });
        }
    });
});




// Chatbot Routes
app.get('/admin/chatbot', (req, res) => {
    db.all("SELECT * FROM chatbot_qa ORDER BY created_at DESC", [], (err, qas) => {
        res.render('admin/chatbot', { active: 'chatbot', qas });
    });
});

app.post('/admin/chatbot/add', (req, res) => {
    const { question, keywords, answer } = req.body;
    db.run("INSERT INTO chatbot_qa (question, keywords, answer) VALUES (?, ?, ?)", [question, keywords, answer], (err) => {
        res.redirect('/admin/chatbot');
    });
});

app.post('/admin/chatbot/add-bulk', (req, res) => {
    const { bulk_text } = req.body;
    
    if (!bulk_text) return res.redirect('/admin/chatbot');

    const lines = bulk_text.split('\n').map(l => l.trim()).filter(l => l);
    let i = 0;
    
    const insertNext = () => {
        if (i >= lines.length) {
            return res.redirect('/admin/chatbot');
        }
        
        // Satır numarasını ve noktayı temizle "1. PE 100 boru nedir?" -> "PE 100 boru nedir?"
        let question = lines[i].replace(/^\d+\.\s*/, '').trim();
        let keywords = lines[i+1] ? lines[i+1].trim() : '';
        let answer = lines[i+2] ? lines[i+2].trim() : '';
        
        if (question && keywords && answer) {
            db.run("INSERT INTO chatbot_qa (question, keywords, answer) VALUES (?, ?, ?)", [question, keywords, answer], (err) => {
                i += 3;
                insertNext();
            });
        } else {
            i++;
            insertNext();
        }
    };
    
    insertNext();
});

app.post('/admin/chatbot/delete/:id', (req, res) => {
    db.run("DELETE FROM chatbot_qa WHERE id = ?", [req.params.id], (err) => {
        res.redirect('/admin/chatbot');
    });
});

app.post('/admin/chatbot/toggle', (req, res) => {
    const { status } = req.body;
    // Safe update for both SQLite and Postgres
    db.get("SELECT key FROM settings WHERE key = 'chatbot_active'", [], (err, row) => {
        if (row) {
            db.run("UPDATE settings SET value = ? WHERE key = 'chatbot_active'", [status], (err) => {
                res.json({ success: !err });
            });
        } else {
            db.run("INSERT INTO settings (key, value) VALUES ('chatbot_active', ?)", [status], (err) => {
                res.json({ success: !err });
            });
        }
    });
});

// Quotes Routes
app.get('/admin/quotes', (req, res) => {
    db.all("SELECT * FROM quotes ORDER BY created_at DESC", [], (err, quotes) => {
        res.render('admin/quotes', { active: 'quotes', quotes });
    });
});

app.post('/admin/quotes/read/:id', (req, res) => {
    db.run("UPDATE quotes SET is_read = 1 WHERE id = ?", [req.params.id], (err) => {
        res.json({ success: !err });
    });
});

app.post('/admin/quotes/delete/:id', (req, res) => {
    db.run("DELETE FROM quotes WHERE id = ?", [req.params.id], (err) => {
        res.redirect('/admin/quotes');
    });
});

// Messages Routes
app.get('/admin/messages', (req, res) => {
    db.all("SELECT * FROM messages ORDER BY created_at DESC", [], (err, messages) => {
        res.render('admin/messages', { active: 'messages', messages });
    });
});

app.post('/admin/messages/read/:id', (req, res) => {
    db.run("UPDATE messages SET is_read = 1 WHERE id = ?", [req.params.id], (err) => {
        res.json({ success: !err });
    });
});

app.post('/admin/messages/delete/:id', (req, res) => {
    db.run("DELETE FROM messages WHERE id = ?", [req.params.id], (err) => {
        res.redirect('/admin/messages');
    });
});

app.get('/admin/logout', (req, res) => {
    req.session = null;
    res.redirect('/admin/login');
});

// Protected Admin Routes
app.use('/admin', requireAuth);

// Unread Messages Badge Middleware for Admin
app.use('/admin', (req, res, next) => {
    db.get("SELECT COUNT(*) as unreadCount FROM messages WHERE is_read = 0", [], (err, row) => {
        res.locals.unreadMessages = row ? row.unreadCount : 0;
        db.get("SELECT COUNT(*) as unreadCount FROM quotes WHERE is_read = 0", [], (err, row2) => {
            res.locals.unreadQuotes = row2 ? row2.unreadCount : 0;
            next();
        });
    });
});


app.get('/admin/dashboard', (req, res) => {
    db.get("SELECT COUNT(*) as count FROM products", [], (err, prodRow) => {
        db.get("SELECT COUNT(*) as count FROM categories", [], (err, catRow) => {
            const today = new Date().toISOString().split('T')[0];
            db.get("SELECT views FROM page_views WHERE date = ?", [today], (err, viewRow) => {
                db.all("SELECT * FROM page_views ORDER BY date DESC LIMIT 7", [], (err, chartRows) => {
                    let chartData = { labels: [], data: [] };
                    if (chartRows) {
                        chartRows.reverse().forEach(r => {
                            chartData.labels.push(r.date.substring(5)); // Show MM-DD
                            chartData.data.push(r.views);
                        });
                    }
                    res.render('admin/dashboard', { 
                        active: 'dashboard',
                        stats: {
                            products: prodRow ? prodRow.count : 0,
                            categories: catRow ? catRow.count : 0,
                            todayViews: viewRow ? viewRow.views : 0
                        },
                        chartData: JSON.stringify(chartData)
                    });
                });
            });
        });
    });
});

app.get('/admin/modules', async (req, res) => {
    const settings = await db.getSettings();
    res.render('admin/modules', { active: 'modules', settings, success: null });
});

app.post('/admin/modules', (req, res) => {
    const toggleKeys = [
        'page_about_active', 'page_products_active', 'page_gallery_active', 
        'page_blog_active', 'page_quote_active', 'page_contact_active',
        'page_services_active', 'page_references_active',
        'home_features_active', 'home_stats_active', 'home_partners_active', 
        'home_testimonials_active', 'whatsapp_button_active', 'maintenance_mode_active'
    ];
    
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        toggleKeys.forEach(key => {
            // Checkboxes only send value if checked. If not in req.body, it's 'false'.
            const val = req.body[key] ? 'true' : 'false';
            stmt.run(key, val);
        });
        db.run("COMMIT", async () => {
            const settings = await db.getSettings();
            res.render('admin/modules', { active: 'modules', settings, success: 'Modül ayarları başarıyla güncellendi.' });
        });
    });
});

app.get('/admin/settings', async (req, res) => {
    const settings = await db.getSettings();
    res.render('admin/settings', { active: 'settings', settings, success: null });
});

app.post('/admin/settings', (req, res) => {
    const keys = Object.keys(req.body);
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        keys.forEach(key => {
            if (key !== 'newPassword' && key !== 'newPasswordConfirm') {
                stmt.run(key, req.body[key]);
            }
        });
        db.run("COMMIT", async () => {
            // Password change handling
            if (req.body.newPassword && req.body.newPassword.trim() !== '') {
                if (req.body.newPassword !== req.body.newPasswordConfirm) {
                    const settings = await db.getSettings();
                    return res.render('admin/settings', { active: 'settings', settings, error: 'Şifreler uyuşmuyor!' });
                }
                const salt = bcrypt.genSaltSync(10);
                const hash = bcrypt.hashSync(req.body.newPassword.trim(), salt);
                db.run("UPDATE users SET password = ? WHERE id = ?", [hash, req.session.userId]);
            }
            const settings = await db.getSettings();
            res.render('admin/settings', { active: 'settings', settings, success: 'Ayarlar başarıyla kaydedildi.' });
        });
    });
});

// Admin Gallery
app.get('/admin/gallery', (req, res) => {
    db.all("SELECT * FROM gallery ORDER BY created_at DESC", (err, gallery) => {
        res.render('admin/gallery', { active: 'gallery', gallery: gallery || [] });
    });
});

app.post('/admin/gallery/add', upload.array('images', 20), (req, res) => {
    if (req.files && req.files.length > 0) {
        const stmt = db.prepare("INSERT INTO gallery (image_url, title) VALUES (?, ?)");
        req.files.forEach(file => {
            stmt.run(file.url, req.body.title || '');
        });
        stmt.finalize();
    }
    res.redirect('/admin/gallery');
});

app.post('/admin/gallery/delete/:id', (req, res) => {
    db.run("DELETE FROM gallery WHERE id = ?", [req.params.id], (err) => {
        res.redirect('/admin/gallery');
    });
});


// Admin References
app.get('/admin/references', (req, res) => {
    db.all("SELECT * FROM references_table ORDER BY created_at DESC", (err, references) => {
        res.render('admin/references', { active: 'references', references: references || [] });
    });
});

app.post('/admin/references/add', upload.array('images', 20), (req, res) => {
    if (req.files && req.files.length > 0) {
        const stmt = db.prepare("INSERT INTO references_table (image_url, title) VALUES (?, ?)");
        req.files.forEach(file => {
            stmt.run(file.url, req.body.title || '');
        });
        stmt.finalize();
    }
    res.redirect('/admin/references');
});

app.post('/admin/references/delete/:id', (req, res) => {
    db.run("DELETE FROM references_table WHERE id = ?", [req.params.id], (err) => {
        res.redirect('/admin/references');
    });
});

// Admin Certificates
app.get('/admin/certificates', (req, res) => {
    db.all("SELECT * FROM certificates ORDER BY created_at DESC", (err, certificates) => {
        res.render('admin/certificates', { active: 'certificates', certificates: certificates || [] });
    });
});

app.post('/admin/certificates/add', upload.array('images', 20), (req, res) => {
    if (req.files && req.files.length > 0) {
        const stmt = db.prepare("INSERT INTO certificates (image_url, title) VALUES (?, ?)");
        req.files.forEach(file => {
            stmt.run(file.url, req.body.title || '');
        });
        stmt.finalize();
    }
    res.redirect('/admin/certificates');
});

app.post('/admin/certificates/delete/:id', (req, res) => {
    db.run("DELETE FROM certificates WHERE id = ?", [req.params.id], (err) => {
        res.redirect('/admin/certificates');
    });
});

// Admin Blogs

app.get('/admin/blogs', (req, res) => {
    db.all("SELECT * FROM blogs ORDER BY created_at DESC", (err, blogs) => {
        res.render('admin/blogs', { active: 'blogs', blogs: blogs || [] });
    });
});

app.get('/admin/blogs/add', (req, res) => {
    res.render('admin/blogs_add', { active: 'blogs' });
});

app.post('/admin/blogs/add', upload.single('image'), (req, res) => {
    const { title, content } = req.body;
    const slug = slugifyTr(title) + '-' + Date.now().toString().slice(-4);
    const imageUrl = req.file ? req.file.url : null;
    db.run("INSERT INTO blogs (title, slug, content, image_url) VALUES (?, ?, ?, ?)", [title, slug, content, imageUrl], (err) => {
        res.redirect('/admin/blogs');
    });
});

app.get('/admin/blogs/edit/:id', (req, res) => {
    db.get("SELECT * FROM blogs WHERE id = ?", [req.params.id], (err, blog) => {
        if (!blog) return res.redirect('/admin/blogs');
        res.render('admin/blogs_edit', { active: 'blogs', blog });
    });
});

app.post('/admin/blogs/edit/:id', upload.single('image'), (req, res) => {
    const { title, content } = req.body;
    const slug = slugifyTr(title) + '-' + req.params.id;
    
    if (req.file) {
        db.run("UPDATE blogs SET title = ?, slug = ?, content = ?, image_url = ? WHERE id = ?", [title, slug, content, req.file.url, req.params.id], (err) => {
            res.redirect('/admin/blogs');
        });
    } else {
        db.run("UPDATE blogs SET title = ?, slug = ?, content = ? WHERE id = ?", [title, slug, content, req.params.id], (err) => {
            res.redirect('/admin/blogs');
        });
    }
});

app.post('/admin/blogs/delete/:id', (req, res) => {
    db.run("DELETE FROM blogs WHERE id = ?", [req.params.id], (err) => {
        res.redirect('/admin/blogs');
    });
});

// Admin Categories
app.get('/admin/categories', (req, res) => {
    db.all("SELECT * FROM categories", (err, categories) => {
        res.render('admin/categories', { active: 'categories', categories });
    });
});

app.post('/admin/categories/add', (req, res) => {
    const { name } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    db.run("INSERT INTO categories (name, slug) VALUES (?, ?)", [name, slug], (err) => {
        res.redirect('/admin/categories');
    });
});

app.post('/admin/categories/delete/:id', (req, res) => {
    db.run("DELETE FROM categories WHERE id = ?", [req.params.id], (err) => {
        res.redirect('/admin/categories');
    });
});

// Admin Products
app.get('/admin/products', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;

    db.get("SELECT COUNT(*) as total FROM products", (err, countResult) => {
        const totalProducts = countResult ? countResult.total : 0;
        const totalPages = Math.ceil(totalProducts / limit);

        db.all("SELECT products.*, categories.name as category_name FROM products LEFT JOIN categories ON products.category_id = categories.id LIMIT ? OFFSET ?", [limit, offset], (err, products) => {
            res.render('admin/products', { active: 'products', products, currentPage: page, totalPages: totalPages });
        });
    });
});

app.get('/admin/products/add', (req, res) => {
    db.all("SELECT * FROM categories", (err, categories) => {
        res.render('admin/products_add', { active: 'products', categories });
    });
});


// Async Image Upload Route
app.post('/admin/products/upload-async', upload.array('images', 10), (req, res) => {
    let urls = [];
    if (req.files && req.files.length > 0) {
        urls = req.files.map(f => f.url);
    }
    res.json({ success: true, urls });
});

app.post('/admin/products/add', upload.array('images', 10), (req, res) => {
    const { name, category_id, description, material, standard, techTableKeys, techTableValues } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') + '-' + Date.now();
    let images = [];
    if (req.body.existing_images) {
        if (Array.isArray(req.body.existing_images)) {
            images = images.concat(req.body.existing_images);
        } else {
            images.push(req.body.existing_images);
        }
    }
    if (req.files && req.files.length > 0) {
        images = images.concat(req.files.map(f => f.url));
    }
    let image_url = images.length > 0 ? JSON.stringify(images) : '';
    
    // Process tech table
    let techTableJson = '[]';
    if (req.body.tech_table_data) {
        try {
            techTableJson = req.body.tech_table_data; // This is already a stringified 2D array from our new UI
        } catch (e) {
            console.error('Error parsing tech_table_data', e);
        }
    } else if (techTableKeys && techTableValues) {
        // Fallback for old forms
        let tableData = [];
        if (Array.isArray(techTableKeys)) {
            for(let i=0; i<techTableKeys.length; i++) {
                if(techTableKeys[i]) tableData.push({ key: techTableKeys[i], value: techTableValues[i] });
            }
        } else if (techTableKeys) {
            tableData.push({ key: techTableKeys, value: techTableValues });
        }
        techTableJson = JSON.stringify(tableData);
    }

    db.run(`INSERT INTO products (category_id, name, slug, description, image_url, material, standard, tech_table_json) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
        [category_id, name, slug, description, image_url, material, standard, techTableJson], 
        (err) => {
            if (err) console.error(err);
            res.redirect('/admin/products');
    });
});

app.post('/admin/products/delete/:id', (req, res) => {
    db.run("DELETE FROM products WHERE id = ?", [req.params.id], (err) => {
        res.redirect('/admin/products');
    });
});

// Admin Content Routes
const contentPages = ['header', 'footer', 'home', 'about', 'services', 'references', 'contact'];

contentPages.forEach(page => {
    app.get(`/admin/content/${page}`, async (req, res) => {
        const settings = await db.getSettings();
        res.render(`admin/content_${page}`, { active: `content_${page}`, settings, success: null });
    });
});

app.post('/admin/content/update', upload.any(), (req, res) => {
    const body = req.body || {};
    const redirect_to = body.redirect_to || 'home';
    const updates = { ...body };
    delete updates.redirect_to;
    
    // Protect existing image URLs from being overwritten by empty text inputs
    const keysToProcess = Object.keys(updates);
    keysToProcess.forEach(key => {
        if (key.startsWith('existing_')) {
            const actualKey = key.replace('existing_', '');
            if (updates[actualKey] === '' && updates[key] !== '') {
                updates[actualKey] = updates[key];
            }
            delete updates[key];
        }
    });
    
    // Add uploaded files to updates
    if (req.files && req.files.length > 0) {
        req.files.forEach(file => {
            updates[file.fieldname] = file.url;
        });
    }

    const keys = Object.keys(updates);
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        keys.forEach(key => {
            stmt.run(key, updates[key]);
        });
        db.run("COMMIT", async () => {
            const settings = await db.getSettings();
            res.render(`admin/content_${redirect_to}`, { active: `content_${redirect_to}`, settings, success: 'İçerikler başarıyla güncellendi.' });
        });
    });
});
    


// Admin Products Edit
app.get('/admin/products/edit/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
        if (!product) return res.redirect('/admin/products');
        db.all("SELECT * FROM categories", (err, categories) => {
            let techTable = [];
            if(product.tech_table_json) {
                try { techTable = JSON.parse(product.tech_table_json); } catch(e){}
            }
            res.render('admin/products_edit', { active: 'products', product, categories, techTable });
        });
    });
});

app.post('/admin/products/edit/:id', upload.array('images', 10), (req, res) => {
    const { name, category_id, description, material, standard, techTableKeys, techTableValues } = req.body;
    
    // Process tech table
    let techTableJson = '[]';
    if (req.body.tech_table_data) {
        try {
            techTableJson = req.body.tech_table_data;
        } catch (e) {
            console.error('Error parsing tech_table_data', e);
        }
    } else if (techTableKeys && techTableValues) {
        let tableData = [];
        if (Array.isArray(techTableKeys)) {
            for(let i=0; i<techTableKeys.length; i++) {
                if(techTableKeys[i]) tableData.push({ key: techTableKeys[i], value: techTableValues[i] });
            }
        } else if (techTableKeys) {
            tableData.push({ key: techTableKeys, value: techTableValues });
        }
        techTableJson = JSON.stringify(tableData);
    }

    let images = [];
    if (req.body.existing_images) {
        if (Array.isArray(req.body.existing_images)) {
            images = req.body.existing_images;
        } else {
            images.push(req.body.existing_images);
        }
    }
    if (req.files && req.files.length > 0) {
        let newImages = req.files.map(f => f.url);
        images = images.concat(newImages);
    }
    
    // Only save string if not empty, otherwise we can save empty string
    const image_url = images.length > 0 ? JSON.stringify(images) : '';

    db.run(`UPDATE products SET category_id=?, name=?, description=?, image_url=?, material=?, standard=?, tech_table_json=? WHERE id=?`, 
        [category_id, name, description, image_url, material, standard, techTableJson, req.params.id], 
        (err) => res.redirect('/admin/products'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = app;
