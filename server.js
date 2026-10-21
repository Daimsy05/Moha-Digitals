require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');
const { Resend } = require('resend');

const app = express();
app.use(cors());
app.use(express.json());

// Serve your index.html and any static files from this folder
app.use(express.static(__dirname));

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// ============================================================
// 1. API Endpoint for CV Optimization
// ============================================================
app.post('/api/optimize', async (req, res) => {
  try {
    const { cvText, jobDescription } = req.body;

    if (!cvText || !jobDescription) {
      return res.status(400).json({ error: 'Please provide both CV and Job Description.' });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are an expert ATS CV Optimizer. Rewrite the user's CV to match the job description. Use impactful bullet points, include missing keywords, and format it cleanly. Return ONLY the optimized CV." 
        },
        { 
          role: "user", 
          content: `JOB DESCRIPTION:\n${jobDescription}\n\nMY CV:\n${cvText}` 
        }
      ]
    });

    res.json({ optimizedCV: completion.choices[0].message.content });

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
