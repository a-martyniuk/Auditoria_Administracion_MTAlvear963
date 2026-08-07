import os
import sys
import re
import json
import fitz  # PyMuPDF

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

LIQUIDACIONES_DIR = "liquidaciones"
OUTPUT_GASTOS = "gastos.json"

# ─────────────────────────────────────────────────────────────────────────────
# TAXONOMÍA LEGAL VIGENTE
# Base: CCyC arts. 2044-2048 | Ley CABA 941 (RPA) | CCT 589/10 (SUTERH/FATERYH)
# ─────────────────────────────────────────────────────────────────────────────

# Mapeo de secciones del PDF OCTOPUS → 10 Rubros Oficiales según Liquidación de Expensas
RUBRO_MAP = {
    # 1. Sueldos y Aportes
    "SUELDOS Y APORTES":                             "Sueldos y Aportes",
    "REMUNERACIONES AL PERSONAL Y CARGAS SOCIALES": "Sueldos y Aportes",
    "REMUNERACIONES AL PERSONAL":                    "Sueldos y Aportes",
    "PAGOS DE HABERES":                              "Sueldos y Aportes",

    # 2. Servicios Públicos
    "SERVICIOS PÚBLICOS":                            "Servicios Públicos",
    "SERVICIOS PUBLICOS":                            "Servicios Públicos",
    "SERVICIOS DE UTILIDAD PUBLICA":                 "Servicios Públicos",

    # 3. Abonos de Servicios
    "ABONOS DE SERVICIOS":                           "Abonos de Servicios",
    "CONTRATOS Y ABONOS":                            "Abonos de Servicios",
    "ABONOS":                                        "Abonos de Servicios",

    # 4. Mantenimiento de Partes Comunes
    "MANTENIMIENTO DE PARTES COMUNES":               "Mantenimiento de Partes Comunes",
    "MANTENIMIENTO Y REPARACIONES":                  "Mantenimiento de Partes Comunes",

    # 5. Trabajos de Reparación en Unidades Funcionales
    "TRABAJOS DE REPARACIÓN EN UNIDADES FUNCIONALES":"Trabajos de Reparación en Unidades Funcionales",
    "TRABAJOS DE REPARACION EN UNIDADES FUNCIONALES":"Trabajos de Reparación en Unidades Funcionales",

    # 6. Gastos Bancarios
    "GASTOS BANCARIOS":                              "Gastos Bancarios",

    # 7. Gastos de Limpieza
    "GASTOS DE LIMPIEZA":                            "Gastos de Limpieza",

    # 8. Gastos de Administración
    "GASTOS DE ADMINISTRACIÓN":                      "Gastos de Administración",
    "GASTOS DE ADMINISTRACION":                      "Gastos de Administración",
    "HONORARIOS DE ADMINISTRACIÓN":                  "Gastos de Administración",

    # 9. Pagos del Período por Seguros
    "PAGOS DEL PERIODO POR SEGUROS":                 "Pagos del Período por Seguros",
    "PAGOS POR SEGUROS":                             "Pagos del Período por Seguros",
    "SEGUROS":                                       "Pagos del Período por Seguros",

    # 10. Otros
    "OTROS":                                         "Otros",
    "GASTOS VARIOS":                                 "Otros",
}

# Líneas a ignorar por completo
IGNORE_PATTERNS = [
    r"^procesado por octopus",
    r"^\d+ de \d+$",
    r"^conf\. art",
    r"^clave de suterh",
    r"^total de gastos",
    r"^total gastos",
    r"^previsiones$",
    r"^sin movimientos",
    r"^estado financiero",
    r"^estado de cuenta",
    r"^movimientos bancarios",
    r"^formas de pago",
    r"^referencia de proveedores",
    r"^datos de juicios",
    r"^ante cualquier",
    r"^total al \d+",
    r"^uf\s+piso",
    r"^\d+\s+de\s+\d+$",
    r"^saldo\b",
    r"^ingreso\b",
    r"^egreso\b",
    r"^cbu\b",
    r"^alias\b",
    r"^nro de cuenta",
    r"^patrimonio\s+neto",
    r"^gastos\s+devengados",
    r"^pendientes?\s+de\s+pago",
    r"^devoluciones",
    r"^ingresos\s+sin\s+identificar",
    r"^\d{2}/\d{2}/\d{4}",
]

def clean_amount(val_str):
    """Convierte string de monto argentino a float."""
    if not val_str:
        return 0.0
    val_str = str(val_str).strip()
    val_str = val_str.replace("$", "").replace(" ", "")
    # Formato argentino: 1.234.567,89
    if "," in val_str and "." in val_str:
        val_str = val_str.replace(".", "").replace(",", ".")
    elif "," in val_str:
        val_str = val_str.replace(",", ".")
    elif "." in val_str and val_str.count(".") == 1:
        # Puede ser decimal tipo 1234.56
        pass
    try:
        result = float(val_str)
        return result if result >= 0 else 0.0
    except ValueError:
        return 0.0

# ─────────────────────────────────────────────────────────────────────────────
# SUB-CATEGORIZACIÓN LEGAL: Sueldos vs. Cargas Sociales (CCT 589/10 + LCT)
# ─────────────────────────────────────────────────────────────────────────────

# Conceptos que son CARGAS SOCIALES (aportes y contribuciones al Estado/gremio)
CARGAS_SOCIALES_PATTERNS = [
    r"afip",
    r"f\s*931",
    r"f\.\s*931",
    r"aporte jubilatorio",
    r"i\.?n\.?s\.?s\.?j\.?p",
    r"inssjp",
    r"pami",
    r"obra social",
    r"cuota sindical",
    r"caja protecci[oó]n",
    r"fateryh",
    r"seracarh",
    r"suterh.*cuota",
    r"fmvdd",
    r"vep",
]

def is_carga_social(text):
    """Determina si un concepto es carga social (vs. remuneración directa)."""
    t = text.lower()
    return any(re.search(p, t) for p in CARGAS_SOCIALES_PATTERNS)


# Mapeo de conceptos técnicos de sueldos/CS a nombres legibles
SUELDO_CONCEPTO_MAP = {
    # Remuneraciones directas — CCT 589/10
    r"sueldo b[áa]sico":                 "Sueldo Básico",
    r"antig[üu]edad":                    "Antigüedad",
    r"retiro.*residuos":                 "Retiro de Residuos",
    r"clasif.*residuos":                 "Clasificación de Residuos",
    r"adicional.*vi[aá]ticos":           "Adicional Viáticos",
    r"suma remunerativa":                "Suma Remunerativa No Retenible",
    r"horas extras.*50":                 "Horas Extras (50%)",
    r"sueldo anual complementario|\bsac\b": "SAC – Sueldo Anual Complementario",
    r"bonif.*anual.*art.*15":            "Bonificación Anual Art.15 CCT589/10",
    r"limpieza.*cochera":                "Limpieza de Cocheras",
    r"plus.*jard[ií]n":                  "Plus Jardín",
    r"t[ií]tulo.*integral":              "Adicional Título Encargado Integral",
    # Cargas sociales — AFIP
    r"afip.*f.?931|f.?931.*afip|vep":   "AFIP F 931 – Contribuciones Laborales",
    r"aporte jubilatorio":               "Jubilación – Aporte Empleado (11%)",
    r"i\.?n\.?s\.?s\.?j\.?p|inssjp":   "INSSJP / PAMI – Aporte Empleado (3%)",
    r"obra social.*suterh|obra social": "Obra Social SUTERH – Aporte Empleado (3%)",
    # Sindicales — SUTERH/FATERYH
    r"cuota sindical.*suterh":           "Cuota Sindical SUTERH (2%)",
    r"art.?27.*bis.*cct|cct.*589":       "Cuota Sindical CCT589/10 (0.75%)",
    r"caja.*protecci[oó]n.*famil":       "Caja Protección Familiar – FATERYH (1%)",
    r"fateryh.*fmvdd":                   "FATERYH – FMVDD (1%)",
    r"fateryh.*seracarh":                "FATERYH / SERACARH – Aportes Patronales",
    r"fateryh":                          "FATERYH – Aportes Patronales",
    r"suterh.*comprobante|suterh.*cuota": "SUTERH – Cuotas Sindicales",
}

def normalize_concepto(text):
    """
    Limpia el concepto de proveedor para que sea legible.
    Ejemplos:
      'Dalla Valle - 30-70803428-9 - - FC Nº0002-00071443 - Reparacion de portero'
      → 'Dalla Valle – Reparacion de portero electrico'
      'SUELDO BÁSICO' → 'Sueldo Básico'
    """
    text_clean = re.sub(r"\$[\d.,]+", "", text)
    text_clean = text_clean.replace('\ufffd', 'í').replace('Perodo', 'Período').replace('Dèbito', 'Débito')
    text_clean = re.sub(r"\n+", " ", text_clean)
    text_clean = re.sub(r"\s+", " ", text_clean).strip()

    # Primero revisar si es un concepto conocido de sueldos
    for pattern, label in SUELDO_CONCEPTO_MAP.items():
        if re.search(pattern, text_clean, re.IGNORECASE):
            return label

    # Formato proveedores: "Proveedor - CUIT/CUIL - ... - FC NºXXX - Descripcion"
    # Separar proveedor del resto
    parts = re.split(r'\s*-\s*', text_clean)
    if len(parts) >= 2:
        proveedor = parts[0].strip()
        # Buscar la descripción: la parte después del Nº de factura
        descripcion = ""
        for i, part in enumerate(parts):
            if re.match(r'FC\s*(Nº|N°)', part, re.IGNORECASE) and i + 1 < len(parts):
                descripcion = " - ".join(parts[i+1:]).strip()
                break
            elif re.match(r'0000', part) and i + 1 < len(parts):
                descripcion = " - ".join(parts[i+1:]).strip()
                break
        if descripcion and len(descripcion) > 5:
            descripcion = descripcion[:100].strip()
            if proveedor and len(proveedor) > 3 and not re.match(r'^[\d\s]+$', proveedor):
                return f"{proveedor} – {descripcion}"
            else:
                return descripcion[:100]
        elif proveedor and len(proveedor) > 3 and not re.match(r'^\d', proveedor):
            # Solo queda el proveedor
            return proveedor[:80]

    # Fallback: devolver el texto limpio
    return text_clean[:100]

def normalize_upper(text):
    """Normaliza texto a mayúsculas manejando acentos y caracteres especiales."""
    replacements = {
        'á': 'Á', 'é': 'É', 'í': 'Í', 'ó': 'Ó', 'ú': 'Ú', 'ü': 'Ü', 'ñ': 'Ñ',
        'à': 'Á', 'è': 'É', 'ì': 'Í', 'ò': 'Ó', 'ù': 'Ú',
    }
    result = text.upper()
    for k, v in replacements.items():
        result = result.replace(k.upper(), v)
    return result

def is_section_header(text_upper):
    """Detecta si el INICIO de un bloque de texto es un encabezado de sección/rubro y retorna (rubro_normalizado, matched_key)."""
    clean = re.sub(r'^\s*\d*\s*\n?\s*', '', text_upper).strip()
    
    # Ordenar por longitud descendente para emparejar la clave más específica al INICIO del bloque
    for key in sorted(RUBRO_MAP.keys(), key=len, reverse=True):
        pattern = r"^\s*\d*\s*" + re.escape(key) + r"\b"
        if re.match(pattern, text_upper, re.IGNORECASE) or re.match(r"^\s*" + re.escape(key) + r"\b", clean, re.IGNORECASE):
            return (RUBRO_MAP[key], key)
    return None

def should_ignore(text):
    tl = text.lower().strip()
    tu = text.upper().strip()

    # Ignorar bloque de resumen de Previsiones al final de la liquidación (no items individuales de honorarios)
    if re.match(r"^PREVISIONES$", tu) or re.match(r"^TOTAL GASTOS\s*-\s*PREVISIONES", tu) or re.match(r"^COMPENSACI[OÓ]N\s*-\s*PREVISIONADO", tu):
        return True

    for pat in IGNORE_PATTERNS:
        if re.match(pat, tl):
            return True
    return False

def extract_amounts_from_block(text):
    """Extrae todos los montos en formato $ X.XXX.XXX,XX de un bloque de texto."""
    pattern = r"\$\s*([\d.]+,\d{2})"
    matches = re.findall(pattern, text)
    amounts = []
    for m in matches:
        amt = clean_amount(m)
        if 100 <= amt <= 100_000_000:
            amounts.append(amt)
    return amounts

def get_page_merged_table_rows(page):
    """
    Unifica bloques de descripción (columna izquierda) y bloques de monto (columna derecha)
    cuando PyMuPDF los separa en bloques distintos dentro del mismo renglón de la tabla.
    """
    raw_blocks = page.get_text("blocks")
    cleaned_blocks = []
    for b in raw_blocks:
        x0, y0, x1, y1, text, bno, btype = b
        t = text.strip()
        if t:
            cleaned_blocks.append({'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1, 'text': t})

    merged = []
    i = 0
    while i < len(cleaned_blocks):
        curr = cleaned_blocks[i]
        curr_text = curr['text']

        # Si el bloque siguiente está en la columna derecha de montos (x0 > 300) y en la misma franja vertical, y NO es un total o porcentaje
        if i + 1 < len(cleaned_blocks):
            nxt = cleaned_blocks[i + 1]
            if nxt['x0'] > 300 and "$" in nxt['text'] and not re.search(r"\bTOTAL\b", nxt['text'], re.IGNORECASE) and not re.search(r"%\s*\d", nxt['text']):
                if abs(curr['y0'] - nxt['y0']) < 25 or (curr['y0'] <= nxt['y0'] and curr['y1'] >= nxt['y0'] - 5):
                    curr_text = curr_text + " " + nxt['text']
                    i += 1  # Consumir el bloque de monto

        merged.append(curr_text)
        i += 1

    return merged

def parse_official_pdf(filepath):
    """
    Parsea un PDF oficial de expensas de OCTOPUS.
    Extrae rubros y conceptos de gastos del consorcio correctamente.
    """
    filename = os.path.basename(filepath)

    # Determinar período
    m_p = re.search(r"(\d{4}-\d{2})", filename)
    if not m_p:
        m_p2 = re.search(r"(\d{2})_(\d{4})", filename)
        if m_p2:
            period = f"{m_p2.group(2)}-{m_p2.group(1)}"
        else:
            return []
    else:
        period = m_p.group(1)

    items = []
    try:
        doc = fitz.open(filepath)
    except Exception as e:
        print(f"  ✗ Error abriendo {filename}: {e}")
        return []

    current_rubro = None
    in_prorrateo = False
    in_estado_financiero = False

    for pnum in range(doc.page_count):
        page = doc[pnum]
        rows = get_page_merged_table_rows(page)

        for raw_text in rows:
            if not raw_text.strip():
                continue

            text = raw_text.strip()
            text_upper = text.upper()

            # Detectar fin de sección de gastos
            if "TOTAL DE GASTOS EN $" in text_upper or "TOTAL GASTOS EN $" in text_upper:
                current_rubro = None
                break

            if "ESTADO DE CUENTA Y PRORRATEO" in text_upper or "ESTADO FINANCIERO" in text_upper or "REFERENCIA DE PROVEEDORES" in text_upper or "PATRIMONIO NETO" in text_upper or "MOVIMIENTOS BANCARIOS" in text_upper:
                current_rubro = None
                in_prorrateo = True
                break

            if should_ignore(text):
                continue

            # Detectar encabezado de rubro/sección
            header_info = is_section_header(text_upper)
            if header_info:
                detected_rubro, matched_key = header_info
                current_rubro = detected_rubro
                pattern = r"^\s*\d*\s*" + re.escape(matched_key) + r"\s*"
                text = re.sub(pattern, "", text, flags=re.IGNORECASE).strip()
                text_upper = text.upper()
                if not text:
                    continue

            # Ignorar totales y subtotales de sección o totales del rubro
            if re.match(r"^Total\s+", text, re.IGNORECASE) or re.match(r"^TOTAL(\s+RUBRO|\s+PARCIAL|\s+SECCI[OÓ]N)?\b", text_upper):
                continue

            # Solo procesar si estamos dentro de un rubro identificado
            if current_rubro is None:
                continue

            # Ignorar bloques con porcentajes solos tipo "% 23.02" o solo números
            if re.match(r"^%\s*[\d.,]+$", text.strip()):
                continue
            if re.match(r"^\d{1,3}[,.]?\d{0,2}$", text.strip()):
                continue

            # Extraer montos del bloque
            amounts = extract_amounts_from_block(text)
            if not amounts:
                continue

            # El monto principal es el ÚLTIMO monto encontrado en el renglón (columna Total/Haber)
            monto = amounts[-1]
            if monto < 100 or monto > 50_000_000:
                continue

            # Construir el concepto limpio
            # El texto suele contener: "Proveedor - CUIT - - FC NºXXX - Descripción\n$monto\n$monto"
            # Limpiar los montos del texto para quedarnos solo con el concepto
            text_no_amounts = re.sub(r"\$[\d.,]+", "", text)
            text_no_amounts = re.sub(r"\n+", " ", text_no_amounts)
            text_no_amounts = re.sub(r"\s+", " ", text_no_amounts).strip()

            # Detectar si parece un prorrateo (formato: "1 PB LOC SAS $xxx")
            if re.match(r"^\d+\s+\w{1,4}\s+\w{1,4}\s+[A-Z,]+\s", text_no_amounts):
                continue

            concepto = normalize_concepto(text_no_amounts)
            if not concepto or len(concepto) < 3:
                concepto = f"{current_rubro} - Comprobante de gasto"

            # ── Reclasificación de "Otros" hacia su rubro natural ──
            current_rubro_efectivo = current_rubro
            if current_rubro == "Otros":
                c_low = concepto.lower()
                SUELDO_OVERRIDES = [r"afip", r"f\s*931", r"suterh", r"fateryh", r"seracarh", r"osperyhra", r"cargas\s+sociales", r"convenio\s+afip", r"adelanto\s+sindicato"]
                MANTO_OVERRIDES = [r"geas\b", r"matafuegos", r"fachadas", r"v[aá]lvula", r"plano\s+de\s+mensura", r"tablero\s+bomba", r"contactor"]
                ADMIN_OVERRIDES = [r"octopus", r"procesamiento.*expensas", r"centro.*gr[aá]fico", r"escaneado", r"franqueo", r"asesor.*legal", r"asesor.*contable", r"honorarios.*mediad", r"certifi.*acta", r"carta.*documento"]
                ABONO_OVERRIDES = [r"noplag", r"desinsectaci[oó]n", r"fumigaci[oó]n", r"ascensor", r"pileta", r"limpieza.*contrato", r"porter[ií]a", r"vigilancia", r"monitoreo"]
                
                if any(re.search(pat, c_low) for pat in SUELDO_OVERRIDES):
                    current_rubro_efectivo = "Sueldos y Aportes"
                elif any(re.search(pat, c_low) for pat in MANTO_OVERRIDES):
                    current_rubro_efectivo = "Mantenimiento de Partes Comunes"
                elif any(re.search(pat, c_low) for pat in ADMIN_OVERRIDES):
                    current_rubro_efectivo = "Gastos de Administración"
                elif any(re.search(pat, c_low) for pat in ABONO_OVERRIDES):
                    current_rubro_efectivo = "Abonos de Servicios"

            # ── Sub-tipo legal: discriminar remuneración directa de carga social ──
            sub_tipo = None
            if current_rubro_efectivo == "Sueldos y Aportes":
                sub_tipo = "Cargas Sociales" if is_carga_social(concepto) else "Remuneración Directa"

            # Determinar tipo (Fijo/Variable)
            tipo = "Fijo" if current_rubro_efectivo in [
                "Sueldos y Aportes",
                "Pagos del Período por Seguros",
                "Servicios Públicos",
                "Abonos de Servicios",
                "Gastos de Administración",
                "Gastos Bancarios"
            ] else "Variable"

            def anonymize_text(text):
                if not text:
                    return text
                text = re.sub(r'(?i)matias\s+antonio\s+oviedo', 'Encargado Titular c/Vivienda', text)
                text = re.sub(r'(?i)oviedo\s+matias\s+antonio', 'Encargado Titular c/Vivienda', text)
                text = re.sub(r'(?i)matias\s+oviedo', 'Encargado Titular c/Vivienda', text)
                text = re.sub(r'(?i)oviedo\s+matias', 'Encargado Titular c/Vivienda', text)
                return text

            item = {
                "periodo": period,
                "rubro": current_rubro_efectivo,
                "concepto": anonymize_text(concepto),
                "monto": monto,
                "tipo": tipo,
                "archivo": filename
            }
            if sub_tipo:
                item["sub_tipo"] = sub_tipo

            items.append(item)

    # Deduplicar ítems idénticos en el mismo período/rubro/concepto/monto
    seen = set()
    unique_items = []
    for item in items:
        key = (item["periodo"], item["rubro"], item["concepto"][:40], round(item["monto"]))
        if key not in seen:
            seen.add(key)
            unique_items.append(item)

    return unique_items


def compute_anomalies(all_gastos):
    """Detecta anomalías estadísticas: incremento >75% con monto base >$30.000."""
    history = {}
    # Procesar en orden cronológico
    for g in sorted(all_gastos, key=lambda x: x["periodo"]):
        key = re.sub(r"\s+", " ", g["concepto"].lower()[:30])
        prev = history.get(key, [])

        # Excluir bonificaciones estacionales (SAC, aguinaldo, vacaciones)
        is_seasonal = any(x in g["concepto"].upper() for x in ["SAC", "AGUINALDO", "BONIF. ANUAL", "VACACION"])

        if len(prev) >= 2 and not is_seasonal:
            avg = sum(prev[-3:]) / len(prev[-3:])
            if avg > 30000 and g["monto"] > (avg * 1.75):
                g["anomalia"] = True
                g["desviacion_pct"] = round(((g["monto"] - avg) / avg) * 100)
            else:
                g["anomalia"] = False
                g["desviacion_pct"] = 0
        else:
            g["anomalia"] = False
            g["desviacion_pct"] = 0

        if key not in history:
            history[key] = []
        history[key].append(g["monto"])

    return all_gastos


def main():
    print("=" * 60)
    print("  PARSER OFICIAL DE EXPENSAS - OCTOPUS/OCTOPUS FORMAT")
    print("=" * 60)

    # Cargar datos existentes para preservar comprobantes y balances
    existing_data = {"comprobantes": [], "balances": [], "multas": []}
    if os.path.exists(OUTPUT_GASTOS):
        try:
            with open(OUTPUT_GASTOS, "r", encoding="utf-8") as f:
                existing_data = json.load(f)
        except Exception:
            pass

    # Encontrar todos los PDFs oficiales
    official_files = sorted([
        os.path.join(LIQUIDACIONES_DIR, f)
        for f in os.listdir(LIQUIDACIONES_DIR)
        if "expensa_oficial" in f.lower()
    ])

    if not official_files:
        print("⚠ No se encontraron archivos 'expensa_oficial.pdf' en la carpeta liquidaciones/")
        return

    print(f"\nPDFs encontrados: {len(official_files)}")

    all_gastos = []
    for filepath in official_files:
        fname = os.path.basename(filepath)
        items = parse_official_pdf(filepath)
        all_gastos.extend(items)
        rubros_count = {}
        for it in items:
            rubros_count[it["rubro"]] = rubros_count.get(it["rubro"], 0) + 1
        print(f"  ✓ {fname[:55]:<55} → {len(items):3d} ítems | {dict(rubros_count)}")

    # Ordenar por período descendente y monto descendente
    all_gastos.sort(key=lambda x: (x["periodo"], x["monto"]), reverse=True)

    # Detectar anomalías
    all_gastos = compute_anomalies(all_gastos)

    # Estadísticas finales
    total_anomalias = sum(1 for g in all_gastos if g.get("anomalia"))
    periodos_unicos = len(set(g["periodo"] for g in all_gastos))
    rubros_unicos = set(g["rubro"] for g in all_gastos)

    print(f"\n{'─'*60}")
    print(f"  Total ítems extraídos  : {len(all_gastos)}")
    print(f"  Períodos cubiertos     : {periodos_unicos}")
    print(f"  Rubros identificados   : {rubros_unicos}")
    print(f"  Alertas de desvío      : {total_anomalias}")
    print(f"{'─'*60}")

    output_data = {
        "gastos": all_gastos,
        "comprobantes": existing_data.get("comprobantes", []),
        "balances": existing_data.get("balances", []),
        "multas": existing_data.get("multas", []),
    }

    with open(OUTPUT_GASTOS, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    print(f"\n✅ Guardado en '{OUTPUT_GASTOS}' exitosamente.")


if __name__ == "__main__":
    main()
