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
    """Convierte monto argentino '$1.234.567,89' a float."""
    s = str(s).strip().replace("$", "").replace(" ", "")
    negative = s.startswith("-")
    s = s.lstrip("-")
    s = s.replace(".", "").replace(",", ".")
    try:
        val = float(s)
        return -val if negative else val
    except:
        return 0.0


def parse_prorrateo_page(page):
    """
    Parsea la página de prorrateo (Estado de Cuenta y Prorrateo) de un PDF OCTOPUS.
    Detecta columnas dinámicamente comparando los X de la fila de encabezado.
    Maneja tres formatos de layout mediante detección per-row:
      - Formato MERGED (2022-2023): columna única "PISO/DPTO" con valores "1-2", "PB-LOC"
      - Formato SEPARADO (2024+): columnas separadas PISO y DPTO (gap ~7px entre ellas)
      - Formato PB/SAS: UF 1 con Piso=PB y Dpto=SAS/LOC (gap ~21px)
    """
    words = page.get_text("words")

    # Agrupar palabras por fila (Y con tolerancia de ~4px)
    rows = {}
    for w in words:
        x0, y0, x1, y1, text, *_ = w
        if not (40 <= y0 <= 780):
            continue
        y_key = round(y0 / 8) * 8
        if y_key not in rows:
            rows[y_key] = []
        rows[y_key].append((x0, text))

    # ── Detectar posiciones de columnas desde el encabezado ──
    col_coef = 410    # default 2026
    col_monto_a = 438 # default 2026
    col_total = 712   # default 2026

    for y_key in sorted(rows.keys())[:5]:
        row = sorted(rows[y_key], key=lambda r: r[0])
        row_text = " ".join(r[1] for r in row).upper()
        if "UF" in row_text and ("PISO" in row_text or "DPTO" in row_text or "%" in row_text):
            # Buscar la posición del primer "(%) " — corresponde al coeficiente A
            for x, txt in row:
                if txt == "(%)" or txt == "%":
                    col_coef = x - 3
                    col_monto_a = x + 30
                    break
            # Buscar total (última columna con monto)
            monto_cols = [x for x, txt in row if re.match(r'^\d{2}/\d{2}$', txt)]
            if monto_cols:
                col_total = monto_cols[0] - 5
            break

    ufs = []
    seen_ufs = set()  # Para deduplicar
    for y_key in sorted(rows.keys()):
        row = sorted(rows[y_key], key=lambda r: r[0])
        words_in_row = [r[1] for r in row]

        # La primera palabra debe ser el número de UF
        first = words_in_row[0] if words_in_row else ""
        if not re.match(r'^\d{1,2}$', first):
            continue
        uf_num = int(first)
        if not (1 <= uf_num <= 30):
            continue

        # ── Filtrar phantom rows (números de página, footers) ──
        # Los UF reales aparecen con x0 >= 40; page numbers aparecen en x~27
        first_x = row[0][0]
        if first_x < 40:
            continue

        # ── Deduplicar: solo la primera aparición de cada UF ──
        if uf_num in seen_ufs:
            continue
        seen_ufs.add(uf_num)

        # La fila debe tener al menos 3 elementos (UF, piso/dpto, algo más)
        if len(row) < 3:
            continue

        def get_at_x(target_x, tolerance=18):
            """Obtiene el valor de la celda más cercana a target_x."""
            best = None
            best_dist = tolerance + 1
            for x, txt in row:
                dist = abs(x - target_x)
                if dist < best_dist:
                    best_dist = dist
                    best = txt
            return best if best_dist <= tolerance else ""

        def get_range_x(x_min, x_max):
            """Obtiene todas las palabras en el rango x_min..x_max."""
            parts = [txt for x, txt in row if x_min <= x <= x_max]
            return " ".join(parts).strip()

        def find_first_coef_in_row():
            """Busca el primer valor de formato coeficiente (ej. 38.58, 3.70) en la fila,
            buscando a partir de x > 380."""
            for x, txt in sorted(row, key=lambda r: r[0]):
                if x < 380:
                    continue
                if re.match(r'^\d{1,2}\.\d{2}$', txt):
                    return x, float(txt)
            return None, 0.0

        # ── PISO y DPTO: Detección per-row basada en contenido y gaps ──
        # Tres formatos posibles:
        #   1. Merged:  row[1] contiene "-" (ej. "1-2", "PB-LOC") → split en "-"
        #   2. Separate: row[2].x está cerca de row[1].x (gap < 15px) → columnas separadas
        #   3. PB/SAS:  row[1] es "PB" y row[2] es "SAS"/"LOC" (gap ~21px) → caso especial
        piso = ""
        dpto = ""

        second_val = row[1][1] if len(row) > 1 else ""
        second_x = row[1][0] if len(row) > 1 else 0

        if "-" in second_val and not second_val.startswith("$") and not second_val.startswith("-$"):
            # Formato merged: "1-2", "PB-LOC", "8-20"
            parts = second_val.split("-", 1)
            piso = parts[0].strip()
            dpto = parts[1].strip()
        elif len(row) >= 3:
            third_x = row[2][0]
            third_val = row[2][1]
            gap_2_3 = third_x - second_x

            if gap_2_3 < 15:
                # Formato separado: PISO y DPTO en columnas contiguas (gap ~7px)
                piso = second_val
                dpto = third_val
            elif third_val.upper() in ('SAS', 'LOC'):
                # Caso especial PB/SAS o PB/LOC (gap ~21px pero es el dpto)
                piso = second_val
                dpto = third_val
            else:
                # Solo columna PISO visible (sin DPTO separado)
                piso = second_val
                dpto = second_val
        else:
            piso = second_val
            dpto = second_val

        # PROPIETARIO: Anonimizado acorde a Sarmiento151
        propietario = ""

        # Saldo anterior y pago (posiciones 195-280 aprox)
        saldo_ant = get_at_x(197, 20)
        if not saldo_ant:
            saldo_ant = get_at_x(210, 20)
        pago = get_at_x(272, 20)
        if not pago:
            pago = get_at_x(258, 20)

        # Deuda
        deuda = get_at_x(330, 20)
        if not deuda:
            deuda = get_at_x(340, 20)

        # Intereses
        interes = get_at_x(400, 20)

        # Coeficiente A: buscar dinámicamente el primer XX.XX después de x>380
        coef_x, coef_a_f = find_first_coef_in_row()

        # Monto A: el primer $ después del coeficiente
        monto_a_f = 0.0
        if coef_x:
            for x, txt in sorted(row, key=lambda r: r[0]):
                if x > coef_x + 5 and txt.startswith("$"):
                    monto_a_f = clean_amt(txt)
                    break

        # Gastos particulares: buscar el $ antes del redondeo
        # Redondeo y total están en los últimas 3 celdas $
        dollar_cells = [(x, clean_amt(txt)) for x, txt in sorted(row, key=lambda r: r[0])
                       if txt.startswith("$") and x > 550]

        gastos_f = 0.0
        redondeo_f = 0.0
        total_f = 0.0

        if len(dollar_cells) >= 2:
            total_f = dollar_cells[-1][1]       # último = TOTAL 2do VTO
            redondeo_f = abs(dollar_cells[-2][1]) if dollar_cells[-2][1] < 200 else 0.0
            # Gastos particulares: buscar el que tiene signo positivo y monto razonable
            for x, amt in dollar_cells[:-2]:
                if 0 < amt < 200000 and x > 580 and x < col_total - 50:
                    gastos_f = amt
                    break
            # Si solo hay 2 celdas $, el total es la penúltima
            if len(dollar_cells) == 2:
                total_f = dollar_cells[-1][1]

        # Deuda real
        deuda_f = 0.0
        if deuda and not deuda.startswith("-"):
            deuda_f = max(0.0, clean_amt(deuda))

        ufs.append({
            "uf": uf_num,
            "piso": piso,
            "dpto": dpto,
            "propietario": propietario if propietario else f"Propietario U.F. {uf_num}",
            "saldo_anterior": clean_amt(saldo_ant),
            "pagos": clean_amt(pago),
            "deuda": deuda_f,
            "interes": clean_amt(interes),
            "ga_pct": coef_a_f,
            "ga_monto": monto_a_f,
            "gb_pct": 0.0,
            "gb_monto": 0.0,
            "multa": 0.0,
            "gastos_extra": gastos_f,
            "fondo_operativo_pct": 0.0,
            "fondo_operativo_monto": 0.0,
            "red_ajustes": redondeo_f,
            "total": total_f,
        })

    return ufs



def main():
    print("=" * 65)
    print("  EXTRACTOR DE PRORRATEO - PÁGINA 6 - PDFs OFICIALES OCTOPUS")
    print("=" * 65)

    official_files = sorted([
        os.path.join(LIQUIDACIONES_DIR, f)
        for f in os.listdir(LIQUIDACIONES_DIR)
        if "expensa_oficial" in f.lower()
    ])

    if not official_files:
        print("⚠ No se encontraron archivos 'expensa_oficial.pdf' en liquidaciones/")
        return

    print(f"\nPDFs encontrados: {len(official_files)}")

    all_records = []

    for filepath in official_files:
        fname = os.path.basename(filepath)

        # Determinar período desde nombre de archivo
        m = re.search(r"(\d{4}-\d{2})", fname)
        if not m:
            continue
        period = m.group(1)

        try:
            doc = fitz.open(filepath)
        except Exception as e:
            print(f"  ✗ Error abriendo {fname}: {e}")
            continue

        # La página de prorrateo suele ser la ÚLTIMA página (índice -1)
        # o la 6ta página (índice 5) cuando son 6 páginas
        prorrateo_page = None
        for pnum in range(doc.page_count - 1, -1, -1):
            page_text = doc[pnum].get_text("text")
            if "ESTADO DE CUENTA Y PRORRATEO" in page_text.upper():
                prorrateo_page = doc[pnum]
                break

        if prorrateo_page is None:
            print(f"  ✗ {fname[:55]} — No se encontró página de prorrateo")
            continue

        ufs = parse_prorrateo_page(prorrateo_page)

        if not ufs:
            print(f"  ✗ {fname[:55]} — 0 UFs extraídas")
            continue

        for u in ufs:
            u["periodo"] = period
            all_records.append(u)

        total_coef = sum(u["ga_pct"] for u in ufs)
        print(f"  ✓ {fname[:55]:<55} → {len(ufs):>2} UFs | Coef total: {total_coef:.2f}%")

    # Ordenar por período desc, luego por UF asc
    all_records.sort(key=lambda r: (r["periodo"], r["uf"]), reverse=False)
    all_records.sort(key=lambda r: r["periodo"], reverse=True)

    output = {"prorrateo": all_records}

    with open(OUTPUT_PRORRATEO, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    periodos = len(set(r["periodo"] for r in all_records))
    print(f"\n{'─'*65}")
    print(f"  Total registros     : {len(all_records)}")
    print(f"  Períodos cubiertos  : {periodos}")
    print(f"  UFs únicas detectadas: {len(set(r['uf'] for r in all_records))}")
    print(f"{'─'*65}")
    print(f"\n✅ Guardado en '{OUTPUT_PRORRATEO}' exitosamente.")


if __name__ == "__main__":
    main()
