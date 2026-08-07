import os
import sys
import json
import re
import requests
from concurrent.futures import ThreadPoolExecutor

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

DOWNLOAD_DIR = "liquidaciones"
API_BASE = "https://lcqsbp4wfl.execute-api.us-west-2.amazonaws.com/staging"

env_file = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_file):
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

CREDENTIALS = {
    "email": os.environ.get("OCTOPUS_EMAIL", ""),
    "password": os.environ.get("OCTOPUS_PASSWORD", "")
}

def clean_filename(filename):
    if not filename:
        return None
    filename = filename.replace('"', '').replace("'", "")
    return re.sub(r'[\\/*?:"<>|]', "_", filename)

def get_auth_token():
    try:
        r = requests.post(f"{API_BASE}/auth/login", json=CREDENTIALS, timeout=15)
        if r.status_code == 200:
            return r.json().get("data", {}).get("token")
        else:
            print(f"[Error] Falló login en Octopus: {r.status_code} {r.text}")
            return None
    except Exception as e:
        print(f"[Error] Excepción durante autenticación: {e}")
        return None

def download_file(url, target_filepath):
    if os.path.exists(target_filepath):
        return False

    try:
        r = requests.get(url, stream=True, timeout=20)
        if r.status_code == 200:
            with open(target_filepath, 'wb') as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            print(f"   [Descargado] -> {os.path.basename(target_filepath)}")
            return True
        else:
            return False
    except Exception:
        return False

def download_official_expensa(exp_info, headers):
    exp_id = exp_info["expense_id"]
    period_fmt = exp_info["periodo"]

    target_path = os.path.join(DOWNLOAD_DIR, f"{period_fmt}_expensa_oficial.pdf")
    if os.path.exists(target_path):
        return False

    try:
        r_dl = requests.get(f"{API_BASE}/expenses/{exp_id}/download", headers=headers, timeout=10)
        if r_dl.status_code == 200:
            url = r_dl.json().get("data", {}).get("url")
            if url:
                return download_file(url, target_path)
    except Exception:
        pass

    return False

def main():
    print("==================================================")
    print("🐙 Ingestor Completo de Expensas Oficiales y Documentos (Octopus)")
    print("Consorcio M. T. de Alvear 961/963 - CABA")
    print("==================================================")

    os.makedirs(DOWNLOAD_DIR, exist_ok=True)

    print("\n1. Autenticando con Octopus Vecinos...")
    token = get_auth_token()
    if not token:
        print("CRÍTICO: No se pudo obtener el token de acceso.")
        sys.exit(1)

    print("   ✓ Autenticación exitosa.")

    headers = {
        "Authorization": f"Bearer {token}",
        "user_functional_unit_id": "242661" # UF 719
    }

    # 2. Fetch Expenses History from API & Download Official PDFs
    print("\n2. Descargando documentos oficiales de expensas del Historial (/expenses)...")
    r_exp = requests.get(f"{API_BASE}/expenses", headers=headers)
    official_dl_count = 0
    if r_exp.status_code == 200:
        expenses_summary = r_exp.json().get("data", {})
        with open("expenses_summary.json", "w", encoding="utf-8") as f:
            json.dump(expenses_summary, f, indent=2, ensure_ascii=False)

        expensas_list = []
        for year in sorted(expenses_summary.keys(), reverse=True):
            for exp in expenses_summary[year].get("expenses", []):
                p_parts = exp.get("period", "").split("/")
                if len(p_parts) == 2:
                    period_fmt = f"{p_parts[1]}-{p_parts[0]}"
                else:
                    period_fmt = exp.get("period")

                expensas_list.append({
                    "expense_id": exp.get("expense_id"),
                    "periodo": period_fmt
                })

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(download_official_expensa, exp, headers) for exp in expensas_list]
            for f in futures:
                if f.result():
                    official_dl_count += 1

        print(f"   ✓ Descargadas {official_dl_count} expensas oficiales en '{DOWNLOAD_DIR}'.")

    # 3. Fetch Documents Folders (All Supporting Invoices & Vouchers)
    print("\n3. Buscando carpetas de comprobantes respaldatorios en repositorio...")
    r_docs = requests.get(f"{API_BASE}/consortia/documents?page=1&pageSize=2000", headers=headers)
    if r_docs.status_code != 200:
        print(f"[Error] No se pudo obtener la lista de documentos: {r_docs.status_code}")
        sys.exit(1)

    folders = r_docs.json().get("data", {}).get("documents", [])
    print(f"   ✓ Encontradas {len(folders)} carpetas de períodos.")

    download_tasks = []

    for folder in folders:
        folder_name = folder.get("name", "").strip()
        if not folder.get("is_folder"):
            continue

        period_match = re.match(r"^([A-Z]+)-(\d{4})$", folder_name, re.IGNORECASE)
        period_str = folder_name
        if period_match:
            month_name = period_match.group(1).upper()
            year_str = period_match.group(2)
            months_map = {
                "ENERO": "01", "FEBRERO": "02", "MARZO": "03", "ABRIL": "04",
                "MAYO": "05", "JUNIO": "06", "JULIO": "07", "AGOSTO": "08",
                "SEPTIEMBRE": "09", "OCTUBRE": "10", "NOVIEMBRE": "11", "DICIEMBRE": "12"
            }
            if month_name in months_map:
                period_str = f"{year_str}-{months_map[month_name]}"

        r_sub = requests.get(f"{API_BASE}/consortia/documents?parentId={folder['id']}&page=1&pageSize=2000", headers=headers)
        if r_sub.status_code != 200:
            continue

        sub_docs = r_sub.json().get("data", {}).get("documents", [])
        for doc in sub_docs:
            doc_name = doc.get("name", "")
            fn = doc.get("file_name", "")
            if not fn:
                continue

            if fn.startswith("http://") or fn.startswith("https://"):
                url = fn
            else:
                clean_fn = fn if fn.startswith("/") else f"/{fn}"
                url = f"https://appv2octopus.s3.amazonaws.com{clean_fn}"

            safe_doc_name = clean_filename(doc_name).replace(" ", "-").lower()
            if safe_doc_name.endswith(".pdf"):
                safe_doc_name = safe_doc_name[:-4]

            if "Liquidación" in doc_name or "Liquidacion" in doc_name:
                target_path = os.path.join(DOWNLOAD_DIR, f"{period_str}_liquidacion.pdf")
            else:
                target_path = os.path.join(DOWNLOAD_DIR, f"{period_str}_{safe_doc_name}.pdf")

            download_tasks.append((url, target_path))

    print(f"\n4. Iniciando descarga de comprobantes en paralelo ({len(download_tasks)} archivos evaluados)...")
    vouchers_dl_count = 0
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(download_file, url, target_path) for url, target_path in download_tasks]
        for future in futures:
            if future.result():
                vouchers_dl_count += 1

    print(f"\n✅ Ingesta completa finalizada. Archivos en 'liquidaciones': {len(os.listdir(DOWNLOAD_DIR))}.")

if __name__ == "__main__":
    main()
