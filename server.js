require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const { Resend } = require('resend');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

// --- DATABASE SETUP (For Access Codes) ---
const DB_FILE = './database.json';
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ codes: {} }));
}
function getDB() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
function generateCode() { return 'MOHA-' + Math.random().toString(36).substring(2, 6).toUpperCase(); }

// --- FILE UPLOAD SETUP ---
const upload = multer({ storage: multer.memoryStorage() });

// ============================================================
// 1. API Endpoint for CV Optimization (Protected by Access Code)
// ============================================================
app.post('/api/optimize', upload.single('cvFile'), async (req, res) => {
  try {
    const { jobDescription, accessCode, cvText: pastedCvText } = req.body;
    let extractedCvText = pastedCvText || '';

    // 1. Extract text from file if uploaded
    if (req.file) {
      try {
        if (req.file.mimetype === 'application/pdf') {
          const pdfData = await pdf(req.file.buffer);
          extractedCvText = pdfData.text;
        } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || req.file.originalname.endsWith('.docx')) {
          const docxData = await mammoth.extractRawText({ buffer: req.file.buffer });
          extractedCvText = docxData.value;
        } else {
          return res.status(400).json({ error: 'Unsupported file type. Upload PDF or DOCX.' });
        }
      } catch (parseError) {
        return res.status(400).json({ error: 'Could not read file. Ensure it is a valid PDF/DOCX.' });
      }
    }

    if (!extractedCvText || !jobDescription) {
      return res.status(400).json({ error: 'Please provide both CV and Job Description.' });
    }

    // 2. Check Credits
    const db = getDB();
    const codeData = db.codes[accessCode?.toUpperCase()];

    if (!codeData) {
      return res.status(403).json({ error: 'Invalid Access Code. Please purchase a plan.' });
    }
    if (codeData.credits <= 0) {
      return res.status(403).json({ error: 'You have used all your credits. Please upgrade.' });
    }

    // 3. Deduct 1 Credit
    db.codes[accessCode.toUpperCase()].credits -= 1;
    saveDB(db);

    // 4. Send to OpenAI
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
    console.error('Optimization Error:', error);
    res.status(500).json({ error: 'Failed to optimize CV.' });
  }
});

// ============================================================
// 2. API Endpoint to Generate Code After Payment
// ============================================================
app.post('/api/claim-plan', (req, res) => {
  const { planName } = req.body;
  let credits = 0;

  if (planName.includes('Starter')) credits = 5;
  else if (planName.includes('Pro')) credits = 10;
  else if (planName.includes('Growth')) credits = 30;
  else if (planName.includes('Unlimited')) credits = 9999;
  else credits = 1; // Default for test

  const newCode = generateCode();
  const db = getDB();
  
  db.codes[newCode] = { credits: credits, plan: planName };
  saveDB(db);

  res.json({ accessCode: newCode, credits: credits });
});

// ============================================================
// 3. API Endpoint for Crypto Payments
// ============================================================
app.post('/api/create-crypto-invoice', async (req, res) => {
  const { amount, description, couponCode } = req.body;

  if (!amount || !description) return res.status(400).json({ error: 'Missing amount or description' });

  let finalAmount = Number(amount);
  const COUPONS = { 'MOHA10': 10, 'WELCOME20': 20, 'VIP50': 50 };
  if (couponCode && COUPONS[couponCode.toUpperCase()]) {
    finalAmount = (finalAmount - (finalAmount * COUPONS[couponCode.toUpperCase()]) / 100).toFixed(2);
  }

  try {
    const response = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price_amount: finalAmount,
        price_currency: 'usd',
        order_description: description,
        // VERY IMPORTANT: We pass the plan name in the URL so the frontend knows which code to generate
        success_url: `https://moha-digitals.onrender.com/?payment=success&plan=${encodeURIComponent(description)}`,
        cancel_url: 'https://moha-digitals.onrender.com/'
      })
    });

    const data = await response.json();
    if (data.invoice_url) res.json({ invoice_url: data.invoice_url });
    else res.status(400).json({ error: 'Failed to generate invoice' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// 4. API Endpoint for Contact Form
// ============================================================
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'All fields required.' });

  try {
    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: 'daims448@gmail.com',
      reply_to: email,
      subject: `New Message from ${name}`,
      html: `<p>Name: ${name}</p><p>Email: ${email}</p><p>Message: ${message}</p>`
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send email.' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
