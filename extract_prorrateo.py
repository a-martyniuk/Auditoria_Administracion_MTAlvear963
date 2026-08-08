"""
extract_prorrateo.py — Extrae datos reales de prorrateo de la página 6
de cada PDF oficial de expensas (OCTOPUS format) y genera prorrateo.json
con los 23 datos de UF por período.
"""
import os, sys, re, json
import fitz  # PyMuPDF

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

LIQUIDACIONES_DIR = "liquidaciones"
OUTPUT_PRORRATEO = "prorrateo.json"


def clean_amt(s):
    """Convierte monto argentino '$1.234.567,89' o '$ -123.456,78' a float."""
    if not s:
        return 0.0
    s = str(s).strip().replace("$", "").replace(" ", "")
    negative = s.startswith("-")
    s = s.lstrip("-")
    if "." in s and "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    elif "." in s:
        parts = s.split(".")
        if len(parts) == 2 and len(parts[1]) <= 2:
            pass
        else:
            s = s.replace(".", "")
    try:
        val = float(s)
        return -val if negative else val
    except:
        return 0.0


def clean_pct(s):
    """Convierte porcentaje string '38.58' o '3.70%' a float."""
    if not s:
        return 0.0
    s = str(s).strip().replace("%", "")
    try:
        return float(s)
    except:
        return 0.0


def parse_prorrateo_page(page):
    """
    Parsea la página de prorrateo (Estado de Cuenta y Prorrateo) de un PDF OCTOPUS.
    Detecta dinámicamente los encabezados y bandas X de cada columna para extraer
    fielmente: Saldo Anterior, Pagos, Deuda, Intereses, GA Coef %, GA Monto $,
    Gastos Particulares, Redondeo y Total por UF.
    """
    words = page.get_text("words")

    # Agrupar palabras por fila (Y con tolerancia de ~6px)
    rows = {}
    for w in words:
        x0, y0, x1, y1, text, *_ = w
        if not (40 <= y0 <= 780):
            continue
        y_key = round(y0 / 6) * 6
        if y_key not in rows:
            rows[y_key] = []
        rows[y_key].append((round(x0, 1), round(x1, 1), text))

    # Detectar encabezados y sus posiciones X
    col_bounds = {}
    for y in sorted(rows.keys())[:15]:
        row_words = sorted(rows[y], key=lambda r: r[0])
        row_text = " ".join(w[2] for w in row_words).upper()
        
        if ("SALDO" in row_text or "DEUDA" in row_text or "PAGO" in row_text or "%" in row_text) and ("ANT" in row_text or "GA" in row_text or "TOTAL" in row_text):
            for x0, x1, txt in row_words:
                u_txt = txt.upper()
                if "SALDO" in u_txt and "saldo_ant" not in col_bounds:
                    col_bounds["saldo_ant"] = x0 - 15
                elif "PAGO" in u_txt and "pago" not in col_bounds:
                    col_bounds["pago"] = x0 - 15
                elif "DEUDA" in u_txt and "deuda" not in col_bounds:
                    col_bounds["deuda"] = x0 - 15
                elif ("INTERES" in u_txt or "TE" in u_txt or "SES" in u_txt) and "interes" not in col_bounds and x0 > 340:
                    col_bounds["interes"] = x0 - 15
                elif ("(%)" in u_txt or "%" in u_txt) and "ga_pct" not in col_bounds and x0 > 390:
                    col_bounds["ga_pct"] = x0 - 15
                elif "GAST" in u_txt and "gastos_part" not in col_bounds and x0 > 600:
                    col_bounds["gastos_part"] = x0 - 15
                elif ("RED" in u_txt or "DON" in u_txt) and "redondeo" not in col_bounds and x0 > 650:
                    col_bounds["redondeo"] = x0 - 15
                elif ("TOTAL" in u_txt or "TAL" in u_txt) and "total" not in col_bounds and x0 > 690:
                    col_bounds["total"] = x0 - 15
            break

    defaults = {
        "saldo_ant": 175, "pago": 245, "deuda": 300, "interes": 360,
        "ga_pct": 405, "gastos_part": 630, "redondeo": 670, "total": 700
    }
    for k, v in defaults.items():
        if k not in col_bounds:
            col_bounds[k] = v

    ufs = []
    seen_ufs = set()

    for y in sorted(rows.keys()):
        row = sorted(rows[y], key=lambda r: r[0])
        if not row: continue
        first_txt = row[0][2]
        first_x = row[0][0]
        uf_num = None
        piso_override, dpto_override = "", ""

        # Caso A: Número de UF estándar (ej: "1", "2", "18")
        if first_x < 80 and re.match(r'^\d{1,2}$', first_txt):
            uf_num = int(first_txt)
        # Caso B: Concatenado (ej: "104-10", "115-11", "187-18", "de 187-18")
        else:
            m = re.search(r'\b(\d{1,2})(\d{1,2}\-[\w]+)\b', " ".join(w[2] for w in row[:3]))
            if m:
                uf_num = int(m.group(1))
                if "-" in m.group(2):
                    parts = m.group(2).split("-", 1)
                    piso_override, dpto_override = parts[0], parts[1]

        if not uf_num or not (1 <= uf_num <= 23) or uf_num in seen_ufs:
            continue
        seen_ufs.add(uf_num)

        def get_words_in_range(x_min, x_max):
            return [w[2] for w in row if (x_min <= w[0] <= x_max or x_min <= (w[0]+w[1])/2 <= x_max)]

        # Extraer Piso / Dpto
        second_txt = row[1][2] if len(row) > 1 else ""
        second_x = row[1][0] if len(row) > 1 else 0
        third_txt = row[2][2] if len(row) >= 3 else ""
        third_x = row[2][0] if len(row) >= 3 else 0

        piso, dpto = "", ""
        if "-" in second_txt and not second_txt.startswith("$"):
            parts = second_txt.split("-", 1)
            piso, dpto = parts[0].strip(), parts[1].strip()
        elif len(row) >= 3 and (third_x - second_x) < 15:
            piso, dpto = second_txt, third_txt
        elif third_txt.upper() in ('SAS', 'LOC'):
            piso, dpto = second_txt, third_txt
        else:
            piso, dpto = second_txt, second_txt

        saldo_ant_str = " ".join(get_words_in_range(col_bounds["saldo_ant"], col_bounds["pago"]))
        pago_str      = " ".join(get_words_in_range(col_bounds["pago"], col_bounds["deuda"]))
        deuda_str     = " ".join(get_words_in_range(col_bounds["deuda"], col_bounds["interes"]))
        interes_str   = " ".join(get_words_in_range(col_bounds["interes"], col_bounds["ga_pct"]))
        
        ga_words = get_words_in_range(col_bounds["ga_pct"], col_bounds["gastos_part"])
        ga_pct_val = 0.0
        ga_monto_val = 0.0
        
        for w in ga_words:
            if not ga_pct_val and re.match(r'^\d{1,2}\.\d{2}$', w):
                ga_pct_val = clean_pct(w)
            elif w.startswith("$"):
                amt = clean_amt(w)
                if amt > 100 and not ga_monto_val:
                    ga_monto_val = amt

        gastos_p_str  = " ".join(get_words_in_range(col_bounds["gastos_part"], col_bounds["redondeo"]))
        redondeo_str  = " ".join(get_words_in_range(col_bounds["redondeo"], col_bounds["total"]))
        total_words   = get_words_in_range(col_bounds["total"], 900)
        
        total_val = 0.0
        for w in reversed(total_words):
            if w.startswith("$"):
                amt = clean_amt(w)
                if abs(amt) > 10:
                    total_val = amt
                    break

        ufs.append({
            "uf": uf_num,
            "piso": piso,
            "dpto": dpto,
            "propietario": f"Propietario U.F. {uf_num}",
            "saldo_anterior": clean_amt(saldo_ant_str),
            "pagos": clean_amt(pago_str),
            "deuda": clean_amt(deuda_str),
            "interes": clean_amt(interes_str),
            "ga_pct": ga_pct_val,
            "ga_monto": ga_monto_val,
            "gb_pct": 0.0,
            "gb_monto": 0.0,
            "multa": 0.0,
            "gastos_extra": clean_amt(gastos_p_str),
            "fondo_operativo_pct": 0.0,
            "fondo_operativo_monto": 0.0,
            "red_ajustes": clean_amt(redondeo_str),
            "total": total_val,
        })

    return ufs


def process_all_official_pdfs():
    official_files = sorted([
        os.path.join(LIQUIDACIONES_DIR, f)
        for f in os.listdir(LIQUIDACIONES_DIR)
        if "expensa_oficial" in f.lower()
    ])

    if not official_files:
        print("⚠ No se encontraron archivos 'expensa_oficial.pdf' en liquidaciones/")
        return {}

    db = {}
    for filepath in official_files:
        filename = os.path.basename(filepath)
        period = filename[:7]

        try:
            doc = fitz.open(filepath)
            all_parsed_ufs = []
            seen_ufs = set()
            for p in range(doc.page_count):
                txt = doc[p].get_text("text").upper()
                if "ESTADO DE CUENTA" in txt or "PRORRATEO" in txt or "SALDO ANT" in txt:
                    ufs_page = parse_prorrateo_page(doc[p])
                    for u in ufs_page:
                        if u["uf"] not in seen_ufs:
                            seen_ufs.add(u["uf"])
                            all_parsed_ufs.append(u)

            all_parsed_ufs.sort(key=lambda x: x["uf"])

            if all_parsed_ufs:
                total_ga = sum(u["ga_pct"] for u in all_parsed_ufs)
                print(f"  ✓ {filename:<50} → {len(all_parsed_ufs):>2} UFs | Coef total: {total_ga:.2f}%")
                db[period] = all_parsed_ufs
            else:
                print(f"  ✗ {filename} — 0 UFs extraídas")
        except Exception as e:
            print(f"  [Error] {filename}: {e}")

    return db


def main():
    print("=" * 65)
    print("  EXTRACTOR DE PRORRATEO - PÁGINA 6 - PDFs OFICIALES OCTOPUS")
    print("=" * 65)

    db = process_all_official_pdfs()

    if db:
        with open(OUTPUT_PRORRATEO, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)

        total_records = sum(len(v) for v in db.values())
        all_ufs = set()
        for period_ufs in db.values():
            for u in period_ufs:
                all_ufs.add(u["uf"])

        print("\n" + "─" * 65)
        print(f"  Total registros     : {total_records}")
        print(f"  Períodos cubiertos  : {len(db)}")
        print(f"  UFs únicas detectadas: {len(all_ufs)}")
        print("─" * 65)
        print(f"\n✅ Guardado en '{OUTPUT_PRORRATEO}' exitosamente.")
    else:
        print("\n❌ No se extrajeron datos de prorrateo.")


if __name__ == "__main__":
    main()
