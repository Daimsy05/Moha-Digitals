require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');
const { Resend } = require('resend');
const multer = require('multer');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');


const app = express();
app.use(cors());
app.use(express.json());

// Serve your index.html and any static files from this folder
app.use(express.static(__dirname));

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);
// Configure multer to store files in memory (RAM)
const upload = multer({ storage: multer.memoryStorage() });

// 1. API Endpoint for CV Optimization (NOW SUPPORTS FILES)
app.post('/api/optimize', upload.single('cvFile'), async (req, res) => {
  try {
    const { jobDescription, accessCode, cvText: pastedCvText } = req.body;
    let extractedCvText = pastedCvText || '';

    // If a file was uploaded, extract the text
    if (req.file) {
      try {
        if (req.file.mimetype === 'application/pdf') {
          const pdfData = await pdf(req.file.buffer);
          extractedCvText = pdfData.text;
        } else if (
          req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
          req.file.originalname.endsWith('.docx')
        ) {
          const docxData = await mammoth.extractRawText({ buffer: req.file.buffer });
          extractedCvText = docxData.value;
        } else {
          return res.status(400).json({ error: 'Unsupported file type. Please upload a PDF or DOCX.' });
        }
      } catch (parseError) {
        console.error("File Parsing Error:", parseError);
        return res.status(400).json({ error: 'Could not read the file. Please ensure it is a valid PDF or DOCX.' });
      }
    }

    if (!extractedCvText || !jobDescription) {
      return res.status(400).json({ error: 'Please provide both CV and Job Description.' });
    }

    // --- CREDIT CHECK LOGIC (From previous step) ---
    const db = getDB();
    const codeData = db.codes[accessCode?.toUpperCase()];

    if (!codeData) {
      return res.status(403).json({ error: 'Invalid Access Code. Please purchase a plan.' });
    }

    if (codeData.credits <= 0) {
      return res.status(403).json({ error: 'You have used all your credits. Please upgrade.' });
    }

    db.codes[accessCode.toUpperCase()].credits -= 1;
    saveDB(db);
    // -----------------------------------------------

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an expert ATS CV Optimizer. Rewrite the user's CV to match the job description. Use impactful bullet points, include missing keywords, and format it cleanly. Return ONLY the optimized CV." },
        { role: "user", content: `JOB DESCRIPTION:\n${jobDescription}\n\nMY CV:\n${extractedCvText}` }
      ]
    });

    res.json({ 
      optimizedCV: completion.choices[0].message.content,
      remainingCredits: db.codes[accessCode.toUpperCase()].credits
    });

  } catch (error) {
    console.error('OpenAI Error:', error);
    res.status(500).json({ error: 'Failed to optimize CV. Check server logs.' });
  }
});

// ============================================================
// 2. API Endpoint for NOWPayments (Crypto Invoices)
// ============================================================
app.post('/api/create-crypto-invoice', async (req, res) => {
  const { amount, description } = req.body;

  if (!amount || !description) {
    return res.status(400).json({ error: 'Missing amount or description' });
  }

  try {
    const response = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.NOWPAYMENTS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        price_amount: amount,
        price_currency: 'usd',
        order_description: description,
        // IMPORTANT: Change 'localhost' to your live domain when you deploy!
        success_url: 'https://moha-digitals.onrender.com/?payment=success',
        cancel_url: 'https://moha-digitals.onrender.com/'
      })
    });

    const data = await response.json();

    if (data.invoice_url) {
      res.json({ invoice_url: data.invoice_url });
    } else {
      console.error('NOWPayments Error details:', data);
      res.status(400).json({ error: 'Failed to generate crypto invoice' });
    }
  } catch (error) {
    console.error('Crypto API Error:', error);
    res.status(500).json({ error: 'Internal server error while creating invoice' });
  }
});

// ============================================================
// 3. API Endpoint for Contact Form (Resend)
// ============================================================
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    const data = await resend.emails.send({
      // Resend requires you to use this "from" address for testing
      from: 'onboarding@resend.dev',
      to: 'daims448@gmail.com', // Your email address
      reply_to: email,          // If you click "reply" in Gmail, it goes to the customer
      subject: `New Moha Digitals Message from ${name}`,
      html: `<p>You have a new message from your website contact form.</p>
             <p><strong>Name:</strong> ${name}</p>
             <p><strong>Email:</strong> ${email}</p>
             <p><strong>Message:</strong></p>
             <p>${message}</p>`
    });

    console.log("Email sent successfully:", data);
    res.json({ success: true, message: 'Email sent successfully!' });
  } catch (error) {
    console.error('Email Error:', error);
    res.status(500).json({ error: 'Failed to send email.' });
  }
});

// ============================================================
// Fallback: serve index.html for any other route (SPA behavior)
// ============================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ Server running!`);
  console.log(`👉 Open your browser and go to: http://localhost:${PORT}\n`);
});
