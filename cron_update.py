import os
import sys
import json
import subprocess
import datetime

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

GASTOS_JSON = "gastos.json"

def main():
    services_only = "--services-only" in sys.argv
    all_mode = "--all" in sys.argv

    print("==================================================")
    print("⏰ Cron Update Coordinator - Consorcio Alvear 961/963")
    print(f"Fecha/Hora actual: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("==================================================")

    # 1. Always update local utilities service status
    print("\n1. Ejecutando verificación de servicios públicos (check_servicios.py)...")
    try:
        subprocess.run([sys.executable, "check_servicios.py"], check=True)
    except Exception as e:
        print(f"[Error] Falló check_servicios.py: {e}")

    if services_only:
        print("\nModo --services-only completado.")
        return

    # 2. Check expected period
    now = datetime.datetime.now()
    if now.month == 1:
        expected_year = now.year - 1
        expected_month = 12
    else:
        expected_year = now.year
        expected_month = now.month - 1

    expected_period = f"{expected_year}-{expected_month:02d}"
    print(f"\n2. Evaluando disponibilidad de expensas para el período vencido: {expected_period}")

    already_has_period = False
    if os.path.exists(GASTOS_JSON) and not all_mode:
        try:
            with open(GASTOS_JSON, "r", encoding="utf-8") as f:
                data = json.load(f)
                gastos = data.get("gastos", [])
                already_has_period = any(g.get("periodo") == expected_period for g in gastos)
        except Exception:
            already_has_period = False

    if already_has_period and not all_mode:
        print(f"   ✓ El período {expected_period} ya se encuentra registrado en '{GASTOS_JSON}'. Omitiendo barrido de descargas.")
    else:
        print(f"   ➜ Iniciando descarga e ingesta completa desde Octopus API...")
        try:
            subprocess.run([sys.executable, "download_octopus.py"], check=True)
            subprocess.run([sys.executable, "parse_official_expensas.py"], check=True)
            subprocess.run([sys.executable, "fix_balances.py"], check=True)
            subprocess.run([sys.executable, "extract_prorrateo.py"], check=True)
            print("\n✅ Proceso de actualización de expensas completado exitosamente.")
        except Exception as e:
            print(f"[Error] Falló el proceso de ingesta: {e}")

if __name__ == "__main__":
    main()
