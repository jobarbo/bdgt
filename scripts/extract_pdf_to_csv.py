from __future__ import annotations

import csv
import re
import subprocess
import sys
from pathlib import Path

PATTERN = re.compile(
    r'^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([–-]?\$?[\d,]+(?:\.\d{2})?)\s+([–-]?\$?[\d,]+(?:\.\d{2})?)\s*$'
)


def to_number(value: str) -> str:
    cleaned = value.strip().replace('–', '-').replace('$', '').replace(',', '')
    if cleaned.startswith('(') and cleaned.endswith(')'):
        cleaned = '-' + cleaned[1:-1]
    return cleaned


def extract_rows(pdf_path: Path) -> list[dict[str, str]]:
    text = subprocess.check_output(['pdftotext', '-layout', str(pdf_path), '-'], text=True)
    rows: list[dict[str, str]] = []

    for line in text.splitlines():
      match = PATTERN.match(line.strip())
      if not match:
          continue
      transaction_date, posted_date, description, amount_raw, balance_raw = match.groups()
      rows.append(
          {
              'transaction_date': transaction_date,
              'posted_date': posted_date,
              'description': description.strip(),
              'amount_cad': to_number(amount_raw),
              'balance_cad': to_number(balance_raw),
          }
      )

    return rows


def main() -> int:
    if len(sys.argv) < 2:
        print('Usage: python scripts/extract_pdf_to_csv.py <input.pdf> [output.csv]')
        return 1

    input_pdf = Path(sys.argv[1])
    if not input_pdf.exists():
        print(f'Input PDF not found: {input_pdf}')
        return 1

    if len(sys.argv) >= 3:
        output_csv = Path(sys.argv[2])
    else:
        output_csv = input_pdf.with_suffix('.csv')

    rows = extract_rows(input_pdf)

    with output_csv.open('w', newline='', encoding='utf-8') as csv_file:
        writer = csv.DictWriter(
            csv_file,
            fieldnames=['transaction_date', 'posted_date', 'description', 'amount_cad', 'balance_cad'],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f'Extracted {len(rows)} transactions to {output_csv}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
