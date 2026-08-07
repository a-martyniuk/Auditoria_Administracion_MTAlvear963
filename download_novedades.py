import os
import sys
import json
import requests

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OUTPUT_DIR = "novedades"
API_BASE = "https://lcqsbp4wfl.execute-api.us-west-2.amazonaws.com/staging"

CREDENTIALS = {
    "email": os.environ.get("OCTOPUS_EMAIL", ""),
    "password": os.environ.get("OCTOPUS_PASSWORD", "")
}

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print("==================================================")
    print("🐙 Descargando Novedades / Comunicados de Octopus")
    print("==================================================")

    # 1. Login
    print("\n1. Autenticando...")
    r = requests.post(f"{API_BASE}/auth/login", json=CREDENTIALS, timeout=15)
    if r.status_code != 200:
        print(f"[Error] Falló login: {r.status_code} {r.text}")
        sys.exit(1)

    auth_data = r.json().get("data", {})
    token = auth_data.get("token")
    print("   ✓ Login exitoso.")

    headers = {
        "Authorization": f"Bearer {token}",
        "user_functional_unit_id": "242661" # UF 719
    }

    # Test candidate API endpoints for news
    candidate_endpoints = [
        "/news",
        "/consortia/news",
        "/consortia/announcements",
        "/consortia/publications",
        "/publications",
        "/announcements",
        "/notifications",
        "/bulletin",
        "/consortia/bulletin"
    ]

    news_data = None
    successful_endpoint = None

    for ep in candidate_endpoints:
        print(f"Probando endpoint API: {ep}...")
        res = requests.get(f"{API_BASE}{ep}", headers=headers)
        print(f"   Status: {res.status_code}")
        if res.status_code == 200:
            news_data = res.json()
            successful_endpoint = ep
            print(f"   ✅ ¡Endpoint encontrado!: {ep}")
            break

    if news_data:
        json_path = os.path.join(OUTPUT_DIR, "novedades.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(news_data, f, indent=2, ensure_ascii=False)
        print(f"\n✓ Guardado JSON de novedades en '{json_path}'.")
    else:
        print("\nNingún endpoint directo devolvió 200. Probaremos con la interfaz web...")

if __name__ == "__main__":
    main()
