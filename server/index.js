import cors from 'cors';
import express from 'express';
import fs from 'node:fs/promises';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const pdfDir = path.join(dataDir, 'pdfs');
const extractedCsvDir = path.join(dataDir, 'csv', 'extracted');
const tempDir = path.join(dataDir, 'tmp');
const upload = multer({ dest: tempDir, limits: { fileSize: 15 * 1024 * 1024 } });
const app = express();
const port = Number.parseInt(process.env.PORT ?? '8787', 10);

app.use(cors({ origin: [/^http:\/\/localhost:\d+$/] }));
app.use(express.json({ limit: '1mb' }));

const ensureDirectories = async () => {
  await Promise.all([
    fs.mkdir(pdfDir, { recursive: true }),
    fs.mkdir(extractedCsvDir, { recursive: true }),
    fs.mkdir(tempDir, { recursive: true }),
  ]);
};

const sanitizeBaseName = (fileName) =>
  path
    .basename(fileName, path.extname(fileName))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'document';

const runExtractScript = (inputPdfPath, outputCsvPath) =>
  new Promise((resolve, reject) => {
    const child = spawn('python3', ['scripts/extract_pdf_to_csv.py', inputPdfPath, outputCsvPath], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `extract_pdf_to_csv.py exited with code ${code}`));
    });
  });

const csvToPreview = async (csvPath) => {
  const rawCsv = await fs.readFile(csvPath, 'utf-8');
  const parsed = Papa.parse(rawCsv, { header: true, skipEmptyLines: true });
  const parseErrors = parsed.errors.map((error) => `CSV: ${error.message}`);

  const transactions = parsed.data
    .map((row, index) => {
      const date = String(row.transaction_date ?? '').trim();
      const description = String(row.description ?? '').trim();
      const amountRaw = String(row.amount_cad ?? '').trim();
      const amount = Number.parseFloat(amountRaw);

      if (!date || !description || Number.isNaN(amount)) {
        parseErrors.push(`Ligne ${index + 2}: extraction incomplete.`);
        return null;
      }

      return {
        date,
        description,
        amount,
        source: 'wealthsimple',
        category: 'Non classe',
      };
    })
    .filter(Boolean);

  return { transactions, errors: parseErrors };
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/import/pdf-preview', upload.single('pdf'), async (req, res) => {
  const uploadedFile = req.file;
  if (!uploadedFile) {
    res.status(400).json({ error: 'Aucun PDF recu.' });
    return;
  }

  try {
    await ensureDirectories();

    const stamp = Date.now();
    const safeBase = sanitizeBaseName(uploadedFile.originalname);
    const storedPdfPath = path.join(pdfDir, `${safeBase}_${stamp}.pdf`);
    const extractedCsvPath = path.join(extractedCsvDir, `${safeBase}_${stamp}_extracted.csv`);

    await fs.rename(uploadedFile.path, storedPdfPath);
    await runExtractScript(storedPdfPath, extractedCsvPath);

    const preview = await csvToPreview(extractedCsvPath);
    res.json({
      sourceLabel: path.basename(storedPdfPath),
      extractedCsvPath: path.relative(rootDir, extractedCsvPath),
      transactions: preview.transactions,
      errors: preview.errors,
    });
  } catch (error) {
    if (uploadedFile?.path) {
      await fs.rm(uploadedFile.path, { force: true }).catch(() => undefined);
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Erreur inconnue lors du traitement PDF.' });
  }
});

ensureDirectories()
  .then(() => {
    app.listen(port, () => {
      console.log(`Budget backend listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to start backend', error);
    process.exitCode = 1;
  });
