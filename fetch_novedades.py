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

r = requests.post(f"{API_BASE}/auth/login", json=CREDENTIALS, timeout=15)
token = r.json().get("data", {}).get("token")

headers = {
    "Authorization": f"Bearer {token}",
    "user_functional_unit_id": "242661"
}

os.makedirs(OUTPUT_DIR, exist_ok=True)

test_urls = [
    f"{API_BASE}/consortia/news?consortium_id=996&version=1&page=1&pageSize=100",
    f"{API_BASE}/consortia/news?consortium_id=996&version=2&page=1&pageSize=100",
    f"{API_BASE}/consortia/996/news?version=1",
    f"{API_BASE}/consortia/996/news?version=2",
    f"{API_BASE}/consortia/996/news",
    f"{API_BASE}/news?consortium_id=996",
    f"{API_BASE}/news?consortiumId=996",
    f"{API_BASE}/news?administrable_id=996"
]

for url in test_urls:
    res = requests.get(url, headers=headers)
    print(f"URL: {url} -> {res.status_code}")
    if res.status_code == 200:
        data = res.json()
        print("  SUCCESS!", json.dumps(data, ensure_ascii=False)[:300])
        out_file = os.path.join(OUTPUT_DIR, "novedades_api.json")
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    else:
        print("  Error:", res.text[:200])
