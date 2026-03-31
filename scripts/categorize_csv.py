from __future__ import annotations

import csv
import sys
from pathlib import Path


def categorize(desc: str, amount: float) -> str:
    d = desc.lower().strip()

    if 'transfer' in d or 'e-transfer' in d:
        return 'Transferts'
    if 'direct deposit' in d or 'interest earned' in d:
        return 'Revenu'
    if 'gumroad' in d:
        return 'Numerique'
    if 'esso' in d or 'shell' in d or 'petro' in d:
        return 'Essence'
    if 'rtc' in d:
        return 'Transport'
    if 'denti' in d:
        return 'Sante'
    if 'atelier signature' in d:
        return 'Soins personnels'
    if 'antitube' in d:
        return 'Loisirs'
    if 'couche-tard' in d or 'proxi extra' in d or 'accommodation cartier' in d:
        return 'Depanneur'
    if 'brunet' in d or 'jean coutu' in d or 'pharmaprix' in d:
        return 'Pharmacie'
    if (
        'restaurant' in d
        or 'tim hortons' in d
        or 'mcdonald' in d
        or 'starbucks' in d
        or 'subway' in d
        or 'sushi' in d
        or 'cedre' in d
        or 'topla' in d
        or 'a&w' in d
        or 'bistro' in d
        or "l'oeufrier" in d
        or 'cafe morgane' in d
        or 'sapristi' in d
        or 'bati bassac' in d
        or 'la cabane a boucane' in d
        or 'pizza salvatore' in d
    ):
        return 'Resto'
    if (
        'supermarche' in d
        or 'super c' in d
        or 'maxi' in d
        or 'iga' in d
        or 'marche' in d
        or 'alimentex' in d
    ):
        return 'Epicerie'
    if 'passe temps' in d:
        return 'Loisirs'
    if 'amazon' in d or 'instant comptant' in d or 'dollarama' in d:
        return 'Shopping'

    if amount > 0:
        return 'Revenu'
    return 'Non classe'


def main() -> int:
    if len(sys.argv) < 2:
        print('Usage: python scripts/categorize_csv.py <input.csv>')
        return 1

    path = Path(sys.argv[1])
    rows = list(csv.DictReader(path.open(encoding='utf-8')))

    for row in rows:
        amount = float(row['amount'])
        row['category'] = categorize(row['description'], amount)

    with path.open('w', newline='', encoding='utf-8') as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=['date', 'description', 'amount', 'category'])
        writer.writeheader()
        writer.writerows(rows)

    print(f'Updated {path} with categories for {len(rows)} rows')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
