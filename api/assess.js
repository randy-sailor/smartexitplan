import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Resend } from 'resend';

// ── TWG Brand Colors ──
const NAVY  = rgb(0.106, 0.165, 0.290);
const GOLD  = rgb(0.784, 0.588, 0.243);
const SAND  = rgb(0.941, 0.929, 0.902);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);
const GRAY  = rgb(0.45, 0.45, 0.45);
const LTGRAY = rgb(0.7, 0.7, 0.7);
const GREEN = rgb(0.12, 0.45, 0.22);
const RED   = rgb(0.6, 0.14, 0.14);

const W = 612, H = 792, ML = 60, MR = 60, CW = 492;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

// ── Helpers ──

function parseNumber(str) {
  if (!str) return NaN;
  let s = String(str).trim().replace(/[$,\s]/g, '');
  const m = s.match(/^(-?\d+\.?\d*)\s*([kmb])?$/i);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  if (m[2]) n *= { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()];
  return n;
}

function fmtCurrency(n) {
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function fmtDate() {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function wrapText(text, font, fontSize, maxWidth) {
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(test, fontSize) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function drawWrapped(page, text, x, y, opts) {
  const { font, fontSize, color, maxWidth, lineHeight } = opts;
  const lh = lineHeight || fontSize * 1.45;
  const lines = wrapText(text, font, fontSize, maxWidth);
  let cy = y;
  for (const line of lines) {
    if (cy < 50) break;
    page.drawText(line, { x, y: cy, size: fontSize, font, color });
    cy -= lh;
  }
  return cy;
}

// ── Claude Analysis ──

async function getAnalysis(revenue, ebitda, industry, description) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const margin = ((ebitda / revenue) * 100).toFixed(1);

  const industryLine = industry ? `Selected Industry: ${industry}` : '';
  const descLine = description ? `Business Description: ${description}` : '';

  const prompt = `You are a mid-market M&A valuation analyst preparing a preliminary valuation assessment for a privately held company.

INPUTS:
- Annual Revenue: $${revenue.toLocaleString('en-US')}
- Annual EBITDA: $${ebitda.toLocaleString('en-US')}
- EBITDA Margin: ${margin}%
${industryLine}
${descLine}

TASK:
Provide a comprehensive valuation assessment. Base your EBITDA multiples on publicly available data from GF Data, Pepperdine Private Capital Markets Project, IBBA/M&A Source Market Pulse, DealStats (BVR), and public company comparables where applicable.

General size-tier guidance for EBITDA multiples (adjust by industry):
- Under $1M EBITDA: typically 2.5x-4.5x
- $1M-$3M EBITDA: typically 3.5x-5.5x
- $3M-$5M EBITDA: typically 4.5x-6.5x
- $5M-$10M EBITDA: typically 5.5x-7.5x
- Over $10M EBITDA: typically 6.5x-9x+
These are baselines. Technology, healthcare, and high-growth sectors trade higher. Capital-intensive, cyclical, and commoditized sectors trade lower.

Return ONLY valid JSON in this exact structure (no markdown, no code fences):

{
  "industry_classification": {
    "naics_sector": "2-digit NAICS code and sector name",
    "industry_name": "Specific industry name (concise)",
    "sic_range": "Applicable SIC code range"
  },
  "valuation_range": {
    "low_multiple": 0.0,
    "mid_multiple": 0.0,
    "high_multiple": 0.0,
    "low_value": 0,
    "mid_value": 0,
    "high_value": 0,
    "methodology_note": "Brief note on methodology and data sources used for this range"
  },
  "size_tier": {
    "tier_name": "e.g. Lower Middle Market",
    "tier_description": "How size affects multiples for this EBITDA level (2-3 sentences)",
    "size_premium_or_discount": "Premium or Discount, with brief explanation"
  },
  "multiple_drivers": {
    "expanding_factors": [
      {"factor": "Factor Name", "description": "One sentence on why this expands multiples in this industry", "typical_impact": "+0.5x to +1.5x"}
    ],
    "compressing_factors": [
      {"factor": "Factor Name", "description": "One sentence on why this compresses multiples in this industry", "typical_impact": "-0.5x to -1.5x"}
    ]
  },
  "industry_outlook": {
    "summary": "2-3 paragraph industry outlook covering current conditions, trends, and M&A activity. Be specific and factual. Use en dashes, never em dashes.",
    "key_trends": ["Trend 1", "Trend 2", "Trend 3", "Trend 4"],
    "m_and_a_activity": "1-2 sentences on recent M&A activity and buyer appetite in this sector",
    "outlook_rating": "Positive or Neutral or Cautious"
  },
  "key_considerations": [
    "Important caveat 1 about this preliminary assessment",
    "Important caveat 2",
    "Important caveat 3"
  ],
  "data_sources": [
    "Source 1 with specificity",
    "Source 2 with specificity"
  ]
}

REQUIREMENTS:
- Provide exactly 4 expanding_factors and 4 compressing_factors, specific to this industry.
- All valuation figures must be EBITDA x multiple. low_value = EBITDA x low_multiple, etc.
- Be honest and balanced. Do not inflate multiples to flatter the owner.
- Include 3-4 key_considerations that are genuine caveats about preliminary assessments.
- Cite 3-4 specific, real data sources in data_sources.
- The industry_outlook.summary should be substantive (150-250 words) and factual.
- Never use em dashes. Use en dashes or hyphens only.
- Return ONLY the JSON object. No other text.`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  let text = msg.content[0].text.trim();
  text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(text);
}

// ── PDF Generation ──

async function generatePDF(analysis, inputs) {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const timesB = await doc.embedFont(StandardFonts.TimesRomanBold);
  const courier = await doc.embedFont(StandardFonts.Courier);

  const margin = ((inputs.ebitda / inputs.revenue) * 100).toFixed(1);
  const v = analysis.valuation_range;

  // ── Page 1: Cover ──
  const p1 = doc.addPage([W, H]);
  p1.drawRectangle({ x: 0, y: 0, width: W, height: H, color: NAVY });
  p1.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: GOLD });

  p1.drawText('SMARTEXITPLAN', {
    x: ML, y: H - 220, size: 13, font: helvB, color: GOLD,
    characterSpacing: 5
  });
  p1.drawText('Valuation', { x: ML, y: H - 280, size: 44, font: timesB, color: WHITE });
  p1.drawText('Assessment', { x: ML, y: H - 330, size: 44, font: timesB, color: WHITE });
  p1.drawRectangle({ x: ML, y: H - 355, width: 70, height: 2, color: GOLD });

  p1.drawText('Prepared for', { x: ML, y: H - 410, size: 10, font: helv, color: LTGRAY });
  p1.drawText(inputs.name, { x: ML, y: H - 430, size: 20, font: timesB, color: WHITE });
  p1.drawText(inputs.company, { x: ML, y: H - 455, size: 13, font: helv, color: LTGRAY });
  p1.drawText(fmtDate(), { x: ML, y: H - 485, size: 10, font: helv, color: GRAY });

  p1.drawRectangle({ x: ML, y: 55, width: CW, height: 0.5, color: GRAY });
  p1.drawText('The Walton Group, Inc.  |  waltongroup.net  |  smartexitplan.com', {
    x: ML, y: 38, size: 7.5, font: helv, color: GRAY
  });

  // ── Page 2: Valuation Summary ──
  const p2 = doc.addPage([W, H]);
  p2.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: GOLD });

  let y2 = H - 55;
  p2.drawText('VALUATION SUMMARY', { x: ML, y: y2, size: 13, font: helvB, color: NAVY, characterSpacing: 2 });
  p2.drawRectangle({ x: ML, y: y2 - 8, width: 55, height: 2, color: GOLD });

  // Metrics row
  y2 -= 50;
  const mw = CW / 4;
  const mets = [
    ['Revenue', fmtCurrency(inputs.revenue)],
    ['EBITDA', fmtCurrency(inputs.ebitda)],
    ['EBITDA Margin', margin + '%'],
    ['Industry', analysis.industry_classification.industry_name]
  ];
  mets.forEach(([label, val], i) => {
    const mx = ML + i * mw;
    p2.drawText(label.toUpperCase(), { x: mx, y: y2, size: 7, font: helvB, color: GRAY, characterSpacing: 0.5 });
    // Truncate long industry names
    let displayVal = val;
    if (helvB.widthOfTextAtSize(displayVal, 13) > mw - 8) {
      while (helvB.widthOfTextAtSize(displayVal + '...', 11) > mw - 8 && displayVal.length > 5) {
        displayVal = displayVal.slice(0, -1);
      }
      displayVal += '...';
      p2.drawText(displayVal, { x: mx, y: y2 - 18, size: 11, font: helvB, color: NAVY });
    } else {
      p2.drawText(displayVal, { x: mx, y: y2 - 18, size: 13, font: helvB, color: NAVY });
    }
  });

  // Valuation range band
  y2 -= 70;
  p2.drawText('ESTIMATED VALUATION RANGE', { x: ML, y: y2, size: 8, font: helvB, color: NAVY, characterSpacing: 1 });
  y2 -= 25;

  // Range bar
  p2.drawRectangle({ x: ML, y: y2 - 8, width: CW, height: 24, color: SAND });
  // Gold gradient indicator at midpoint
  const barMid = ML + CW * 0.5;
  p2.drawRectangle({ x: barMid - 1.5, y: y2 - 8, width: 3, height: 24, color: GOLD });

  // Low
  y2 -= 40;
  p2.drawText('LOW', { x: ML, y: y2 + 55, size: 7, font: helvB, color: GRAY });
  p2.drawText(fmtCurrency(v.low_value), { x: ML, y: y2 + 40, size: 16, font: helvB, color: NAVY });
  p2.drawText(v.low_multiple + 'x EBITDA', { x: ML, y: y2 + 25, size: 8, font: courier, color: GRAY });

  // Mid (centered)
  const midValText = fmtCurrency(v.mid_value);
  const midValW = helvB.widthOfTextAtSize(midValText, 18);
  p2.drawText('MIDPOINT', { x: barMid - helvB.widthOfTextAtSize('MIDPOINT', 7) / 2, y: y2 + 55, size: 7, font: helvB, color: GOLD });
  p2.drawText(midValText, { x: barMid - midValW / 2, y: y2 + 38, size: 18, font: helvB, color: GOLD });
  const midMultText = v.mid_multiple + 'x EBITDA';
  p2.drawText(midMultText, { x: barMid - courier.widthOfTextAtSize(midMultText, 8) / 2, y: y2 + 25, size: 8, font: courier, color: GRAY });

  // High
  const highValText = fmtCurrency(v.high_value);
  const highValW = helvB.widthOfTextAtSize(highValText, 16);
  const rightEdge = ML + CW;
  p2.drawText('HIGH', { x: rightEdge - helvB.widthOfTextAtSize('HIGH', 7), y: y2 + 55, size: 7, font: helvB, color: GRAY });
  p2.drawText(highValText, { x: rightEdge - highValW, y: y2 + 40, size: 16, font: helvB, color: NAVY });
  const hiMultText = v.high_multiple + 'x EBITDA';
  p2.drawText(hiMultText, { x: rightEdge - courier.widthOfTextAtSize(hiMultText, 8), y: y2 + 25, size: 8, font: courier, color: GRAY });

  // Size tier
  y2 -= 10;
  p2.drawRectangle({ x: ML, y: y2, width: CW, height: 0.5, color: LTGRAY });
  y2 -= 22;
  p2.drawText('SIZE TIER: ' + analysis.size_tier.tier_name.toUpperCase(), { x: ML, y: y2, size: 8, font: helvB, color: NAVY, characterSpacing: 0.5 });
  y2 -= 16;
  y2 = drawWrapped(p2, analysis.size_tier.tier_description, ML, y2, { font: helv, fontSize: 9.5, color: GRAY, maxWidth: CW, lineHeight: 13 });

  // Methodology
  y2 -= 18;
  p2.drawRectangle({ x: ML, y: y2 + 6, width: CW, height: 0.5, color: LTGRAY });
  y2 -= 10;
  p2.drawText('METHODOLOGY', { x: ML, y: y2, size: 8, font: helvB, color: NAVY, characterSpacing: 0.5 });
  y2 -= 16;
  y2 = drawWrapped(p2, v.methodology_note, ML, y2, { font: helv, fontSize: 9.5, color: GRAY, maxWidth: CW, lineHeight: 13 });

  // Footer
  p2.drawText('SmartExitPlan Valuation Assessment  |  The Walton Group, Inc.', { x: ML, y: 30, size: 7, font: helv, color: GRAY });
  p2.drawText('2', { x: W - MR - 5, y: 30, size: 7, font: helv, color: GRAY });

  // ── Page 3: Industry Analysis & Value Drivers ──
  const p3 = doc.addPage([W, H]);
  p3.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: GOLD });

  let y3 = H - 55;
  p3.drawText('INDUSTRY ANALYSIS', { x: ML, y: y3, size: 13, font: helvB, color: NAVY, characterSpacing: 2 });
  p3.drawRectangle({ x: ML, y: y3 - 8, width: 55, height: 2, color: GOLD });
  y3 -= 30;

  // Outlook badge
  const rating = analysis.industry_outlook.outlook_rating || 'Neutral';
  const badgeColor = rating === 'Positive' ? GREEN : rating === 'Cautious' ? RED : GRAY;
  p3.drawText('OUTLOOK: ' + rating.toUpperCase(), { x: ML, y: y3, size: 8, font: helvB, color: badgeColor, characterSpacing: 0.5 });
  y3 -= 18;

  // Industry outlook narrative
  y3 = drawWrapped(p3, analysis.industry_outlook.summary, ML, y3, { font: helv, fontSize: 9.5, color: BLACK, maxWidth: CW, lineHeight: 13.5 });

  // M&A Activity
  y3 -= 14;
  p3.drawText('M&A ACTIVITY', { x: ML, y: y3, size: 8, font: helvB, color: NAVY, characterSpacing: 0.5 });
  y3 -= 14;
  y3 = drawWrapped(p3, analysis.industry_outlook.m_and_a_activity, ML, y3, { font: helv, fontSize: 9.5, color: GRAY, maxWidth: CW, lineHeight: 13 });

  // Key trends
  y3 -= 14;
  p3.drawText('KEY TRENDS', { x: ML, y: y3, size: 8, font: helvB, color: NAVY, characterSpacing: 0.5 });
  y3 -= 14;
  for (const trend of (analysis.industry_outlook.key_trends || []).slice(0, 4)) {
    p3.drawText('•', { x: ML + 2, y: y3, size: 9, font: helv, color: GOLD });
    y3 = drawWrapped(p3, trend, ML + 15, y3, { font: helv, fontSize: 9.5, color: BLACK, maxWidth: CW - 15, lineHeight: 13 });
    y3 -= 5;
  }

  // Value Drivers header
  y3 -= 16;
  p3.drawRectangle({ x: ML, y: y3 + 8, width: CW, height: 0.5, color: LTGRAY });
  y3 -= 6;
  p3.drawText('VALUE DRIVERS', { x: ML, y: y3, size: 13, font: helvB, color: NAVY, characterSpacing: 2 });
  p3.drawRectangle({ x: ML, y: y3 - 8, width: 55, height: 2, color: GOLD });
  y3 -= 26;

  // Expanding factors
  p3.drawText('FACTORS THAT EXPAND MULTIPLES', { x: ML, y: y3, size: 8, font: helvB, color: GREEN, characterSpacing: 0.5 });
  y3 -= 15;
  for (const f of (analysis.multiple_drivers.expanding_factors || []).slice(0, 4)) {
    if (y3 < 80) break;
    p3.drawText('+', { x: ML, y: y3, size: 7, font: helv, color: GREEN });
    p3.drawText(f.factor, { x: ML + 14, y: y3, size: 9.5, font: helvB, color: NAVY });
    const impactW = courier.widthOfTextAtSize(f.typical_impact, 7.5);
    p3.drawText(f.typical_impact, { x: ML + CW - impactW, y: y3, size: 7.5, font: courier, color: GREEN });
    y3 -= 13;
    y3 = drawWrapped(p3, f.description, ML + 14, y3, { font: helv, fontSize: 8.5, color: GRAY, maxWidth: CW - 14, lineHeight: 11.5 });
    y3 -= 7;
  }

  // Compressing factors
  y3 -= 8;
  if (y3 > 60) {
    p3.drawText('FACTORS THAT COMPRESS MULTIPLES', { x: ML, y: y3, size: 8, font: helvB, color: RED, characterSpacing: 0.5 });
    y3 -= 15;
    for (const f of (analysis.multiple_drivers.compressing_factors || []).slice(0, 4)) {
      if (y3 < 60) break;
      p3.drawText('-', { x: ML, y: y3, size: 7, font: helv, color: RED });
      p3.drawText(f.factor, { x: ML + 14, y: y3, size: 9.5, font: helvB, color: NAVY });
      const impW = courier.widthOfTextAtSize(f.typical_impact, 7.5);
      p3.drawText(f.typical_impact, { x: ML + CW - impW, y: y3, size: 7.5, font: courier, color: RED });
      y3 -= 13;
      y3 = drawWrapped(p3, f.description, ML + 14, y3, { font: helv, fontSize: 8.5, color: GRAY, maxWidth: CW - 14, lineHeight: 11.5 });
      y3 -= 7;
    }
  }

  p3.drawText('SmartExitPlan Valuation Assessment  |  The Walton Group, Inc.', { x: ML, y: 30, size: 7, font: helv, color: GRAY });
  p3.drawText('3', { x: W - MR - 5, y: 30, size: 7, font: helv, color: GRAY });

  // ── Page 4: Next Steps ──
  const p4 = doc.addPage([W, H]);
  p4.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: GOLD });

  let y4 = H - 55;
  p4.drawText('YOUR NEXT STEP', { x: ML, y: y4, size: 13, font: helvB, color: NAVY, characterSpacing: 2 });
  p4.drawRectangle({ x: ML, y: y4 - 8, width: 55, height: 2, color: GOLD });
  y4 -= 30;

  y4 = drawWrapped(p4, 'This assessment provides a preliminary valuation range based on publicly available market data for your industry and size tier. It indicates where a business like yours would typically trade in the current M&A environment. However, every business has unique characteristics that move value up or down within this range - and often beyond it.', ML, y4, { font: helv, fontSize: 10, color: BLACK, maxWidth: CW, lineHeight: 14 });
  y4 -= 8;
  y4 = drawWrapped(p4, 'A comprehensive SmartExitPlan engagement uses a proprietary diagnostic framework to identify exactly where your business falls within the range and what specific actions would move it higher before you go to market.', ML, y4, { font: helv, fontSize: 10, color: BLACK, maxWidth: CW, lineHeight: 14 });

  // Engagement overview
  y4 -= 22;
  p4.drawText('THE SMARTEXITPLAN ENGAGEMENT', { x: ML, y: y4, size: 8, font: helvB, color: NAVY, characterSpacing: 1 });
  y4 -= 16;
  const phases = [
    'Value Growth Assessment - 38-point diagnostic across four domains of business value',
    'Strategic Readiness Analysis - gap identification against buyer expectations and market standards',
    'Growth Implementation - targeted initiatives that expand your EBITDA multiple before exit',
    'Exit Preparation - positioning, packaging, and process management through close'
  ];
  for (const phase of phases) {
    p4.drawText('>', { x: ML + 2, y: y4, size: 10, font: helv, color: GOLD });
    y4 = drawWrapped(p4, phase, ML + 16, y4, { font: helv, fontSize: 9.5, color: BLACK, maxWidth: CW - 16, lineHeight: 13 });
    y4 -= 7;
  }

  // Key considerations
  y4 -= 16;
  p4.drawRectangle({ x: ML, y: y4 + 8, width: CW, height: 0.5, color: LTGRAY });
  y4 -= 6;
  p4.drawText('IMPORTANT CONSIDERATIONS', { x: ML, y: y4, size: 8, font: helvB, color: NAVY, characterSpacing: 0.5 });
  y4 -= 14;
  for (const c of (analysis.key_considerations || []).slice(0, 4)) {
    p4.drawText('•', { x: ML + 2, y: y4, size: 9, font: helv, color: GRAY });
    y4 = drawWrapped(p4, c, ML + 15, y4, { font: helv, fontSize: 8.5, color: GRAY, maxWidth: CW - 15, lineHeight: 12 });
    y4 -= 5;
  }

  // Data sources
  y4 -= 12;
  p4.drawText('DATA SOURCES', { x: ML, y: y4, size: 7, font: helvB, color: GRAY, characterSpacing: 0.5 });
  y4 -= 11;
  for (const s of (analysis.data_sources || []).slice(0, 4)) {
    y4 = drawWrapped(p4, s, ML, y4, { font: helv, fontSize: 7.5, color: GRAY, maxWidth: CW, lineHeight: 10 });
    y4 -= 3;
  }

  // CTA bar
  const ctaH = 60;
  const ctaY = Math.max(40, y4 - ctaH - 15);
  p4.drawRectangle({ x: ML, y: ctaY, width: CW, height: ctaH, color: NAVY });
  p4.drawRectangle({ x: ML, y: ctaY + ctaH - 3, width: CW, height: 3, color: GOLD });
  p4.drawText('Ready to close the gap between where you are and what your business could be worth?', {
    x: ML + 18, y: ctaY + 35, size: 10, font: timesB, color: WHITE
  });
  p4.drawText('smartexitplan.com   |   randy@waltongroup.net', {
    x: ML + 18, y: ctaY + 15, size: 9, font: helv, color: GOLD
  });

  p4.drawText('SmartExitPlan Valuation Assessment  |  The Walton Group, Inc.', { x: ML, y: 30, size: 7, font: helv, color: GRAY });
  p4.drawText('4', { x: W - MR - 5, y: 30, size: 7, font: helv, color: GRAY });

  return Buffer.from(await doc.save());
}

// ── Email Templates ──

function customerEmail(analysis, inputs) {
  const v = analysis.valuation_range;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:Georgia,serif">
<div style="max-width:600px;margin:0 auto;background:#ffffff">
  <div style="background:#1B2A4A;padding:28px 32px;text-align:center">
    <span style="color:#C8963E;font-size:12px;letter-spacing:4px;font-family:Helvetica,sans-serif">SMARTEXITPLAN</span>
  </div>
  <div style="padding:32px;border-bottom:3px solid #C8963E">
    <h2 style="color:#1B2A4A;margin:0 0 16px;font-size:22px">Your Valuation Assessment</h2>
    <p style="color:#333;line-height:1.6;margin:0 0 14px">${inputs.name},</p>
    <p style="color:#333;line-height:1.6;margin:0 0 14px">Thank you for using SmartExitPlan. Your preliminary valuation assessment for <strong>${inputs.company}</strong> is attached as a PDF.</p>
    <div style="background:#F0EDE6;padding:20px;margin:20px 0;border-left:3px solid #C8963E">
      <p style="margin:0 0 8px;color:#1B2A4A;font-family:Helvetica,sans-serif;font-size:11px;letter-spacing:1px"><strong>ESTIMATED VALUATION RANGE</strong></p>
      <p style="margin:0;color:#1B2A4A;font-size:24px;font-weight:bold">${fmtCurrency(v.low_value)} &ndash; ${fmtCurrency(v.high_value)}</p>
      <p style="margin:6px 0 0;color:#666;font-size:13px;font-family:Courier,monospace">${v.low_multiple}x &ndash; ${v.high_multiple}x EBITDA &nbsp;|&nbsp; ${analysis.industry_classification.industry_name}</p>
    </div>
    <p style="color:#333;line-height:1.6;margin:0 0 14px">This assessment is based on publicly available market data and provides a preliminary range. A comprehensive SmartExitPlan engagement refines this estimate based on the specific characteristics of your business - the factors that expand or compress your multiple within this range.</p>
    <p style="color:#333;line-height:1.6;margin:0 0 14px">An advisor from The Walton Group will review your submission and may reach out within two business days.</p>
  </div>
  <div style="padding:20px 32px;text-align:center;color:#999;font-size:12px;font-family:Helvetica,sans-serif">
    <p style="margin:0 0 4px;color:#C8963E;font-style:italic">The Walton Group, Inc.</p>
    <p style="margin:0">waltongroup.net &nbsp;|&nbsp; smartexitplan.com</p>
  </div>
</div>
</body></html>`;
}

function notifyEmail(analysis, inputs) {
  const v = analysis.valuation_range;
  const margin = ((inputs.ebitda / inputs.revenue) * 100).toFixed(1);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#f5f4f0;font-family:Helvetica,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff;padding:24px;border-top:4px solid #C8963E">
  <h2 style="color:#1B2A4A;margin:0 0 16px">New SmartExitPlan Assessment</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#1B2A4A;width:120px">Name</td><td style="padding:6px 0">${inputs.name}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#1B2A4A">Email</td><td style="padding:6px 0"><a href="mailto:${inputs.email}">${inputs.email}</a></td></tr>
    <tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#1B2A4A">Company</td><td style="padding:6px 0">${inputs.company}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#1B2A4A">Phone</td><td style="padding:6px 0">${inputs.phone || 'Not provided'}</td></tr>
    <tr style="border-top:1px solid #eee"><td style="padding:6px 12px 6px 0;font-weight:bold;color:#1B2A4A">Revenue</td><td style="padding:6px 0">${fmtCurrency(inputs.revenue)}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#1B2A4A">EBITDA</td><td style="padding:6px 0">${fmtCurrency(inputs.ebitda)}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#1B2A4A">Margin</td><td style="padding:6px 0">${margin}%</td></tr>
    <tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#1B2A4A">Industry</td><td style="padding:6px 0">${inputs.industry || 'Not selected'}</td></tr>
    ${inputs.business_description ? `<tr><td style="padding:6px 12px 6px 0;font-weight:bold;color:#1B2A4A;vertical-align:top">Description</td><td style="padding:6px 0">${inputs.business_description}</td></tr>` : ''}
  </table>
  <div style="margin:16px 0;padding:16px;background:#F0EDE6;border-left:3px solid #C8963E">
    <p style="margin:0 0 4px;font-weight:bold;color:#1B2A4A">Assessment Result</p>
    <p style="margin:0;font-size:18px;color:#1B2A4A"><strong>${fmtCurrency(v.low_value)} &ndash; ${fmtCurrency(v.high_value)}</strong></p>
    <p style="margin:4px 0 0;color:#666;font-size:13px">${v.low_multiple}x &ndash; ${v.high_multiple}x | ${analysis.industry_classification.industry_name} | Outlook: ${analysis.industry_outlook.outlook_rating}</p>
  </div>
  <p style="color:#999;font-size:12px;margin:16px 0 0">Full PDF attached. Submitted ${fmtDate()}.</p>
</div>
</body></html>`;
}

// ── Email Sending ──

async function sendEmails(pdfBuffer, analysis, inputs) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM || 'SmartExitPlan <onboarding@resend.dev>';
  const safeName = inputs.company.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');

  // Send to customer
  await resend.emails.send({
    from,
    to: [inputs.email],
    subject: `Your SmartExitPlan Valuation Assessment - ${inputs.company}`,
    html: customerEmail(analysis, inputs),
    attachments: [{
      filename: `SmartExitPlan-Assessment-${safeName}.pdf`,
      content: pdfBuffer.toString('base64')
    }]
  });

  // Notify Randy
  const notifyTo = process.env.NOTIFY_EMAIL || 'randy@waltongroup.net';
  await resend.emails.send({
    from,
    to: [notifyTo],
    subject: `New Assessment: ${inputs.company} - ${fmtCurrency(inputs.revenue)} Revenue`,
    html: notifyEmail(analysis, inputs),
    attachments: [{
      filename: `SmartExitPlan-Assessment-${safeName}.pdf`,
      content: pdfBuffer.toString('base64')
    }]
  });
}

// ── Main Handler ──

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;

    // Parse numbers
    const revenue = parseNumber(body.revenue);
    const ebitda = parseNumber(body.ebitda);
    const industry = (body.industry || '').trim();
    const description = (body.business_description || '').trim();
    const name = (body.name || '').trim();
    const email = (body.email || '').trim();
    const company = (body.company || '').trim();
    const phone = (body.phone || '').trim();

    // Validate
    if (isNaN(revenue) || revenue <= 0) {
      return res.status(400).json({ error: 'Please enter a valid annual revenue.' });
    }
    if (isNaN(ebitda)) {
      return res.status(400).json({ error: 'Please enter a valid EBITDA number.' });
    }
    if (!name || !email || !company) {
      return res.status(400).json({ error: 'Name, email, and company name are required.' });
    }
    if (!industry && !description) {
      return res.status(400).json({ error: 'Please select an industry or describe your business.' });
    }

    // Run analysis
    const analysis = await getAnalysis(revenue, ebitda, industry, description);

    // Generate PDF
    const inputs = { revenue, ebitda, industry, business_description: description, name, email, company, phone };
    const pdfBuffer = await generatePDF(analysis, inputs);

    // Send emails
    await sendEmails(pdfBuffer, analysis, inputs);

    return res.status(200).json({ success: true, message: 'Assessment sent to ' + email });

  } catch (err) {
    console.error('Assessment error:', err);
    return res.status(500).json({
      error: 'Something went wrong generating your assessment. Please try again or contact randy@waltongroup.net directly.'
    });
  }
}
