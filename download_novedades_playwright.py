import asyncio
import json
import os
import sys
import requests

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OUTPUT_DIR = "novedades"
os.makedirs(OUTPUT_DIR, exist_ok=True)

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("Playwright no instalado en Python, instalando o probando alternativa...")
    os.system("pip install playwright")
    os.system("python -m playwright install chromium")
    from playwright.async_api import async_playwright

async def main():
    print("==================================================")
    print("🐙 Extractor de Novedades de Octopus Vecinos")
    print("==================================================")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        api_responses = []

        # Intercept network responses to capture news API calls
        async def handle_response(response):
            try:
                url = response.url
                if "news" in url.lower() or "announcement" in url.lower() or "publication" in url.lower() or "post" in url.lower():
                    if response.status == 200:
                        ct = response.headers.get("content-type", "")
                        if "json" in ct:
                            data = await response.json()
                            api_responses.append({"url": url, "data": data})
                            print(f"   [API Capturada] {url}")
            except Exception:
                pass

        page.on("response", handle_response)

        # 1. Go to login
        print("\n1. Navegando a https://vecinos.octopus.com.ar/login...")
        await page.goto("https://vecinos.octopus.com.ar/login", wait_until="networkidle")

        # Fill credentials
        print("   Iniciando sesión...")
        await page.fill("input[type='email'], input[name='email'], input[placeholder*='Email'], input[placeholder*='correo']", os.environ.get("OCTOPUS_EMAIL", ""))
        await page.fill("input[type='password'], input[name='password'], input[placeholder*='Contraseña']", os.environ.get("OCTOPUS_PASSWORD", ""))

        # Click login button
        login_btn = page.locator("button:has-text('Iniciar'), button:has-text('Ingresar'), button[type='submit']")
        await login_btn.first.click()

        await page.wait_for_timeout(5000)
        print(f"   URL post-login: {page.url}")

        # 2. Go to /news
        print("\n2. Navegando a https://vecinos.octopus.com.ar/news...")
        await page.goto("https://vecinos.octopus.com.ar/news", wait_until="networkidle")
        await page.wait_for_timeout(5000)

        # Scroll down to load all news items if infinite scroll
        for _ in range(5):
            await page.evaluate("window.scrollBy(0, 1000)")
            await page.wait_for_timeout(1000)

        # Extract page HTML and text content
        content_html = await page.content()
        with open(os.path.join(OUTPUT_DIR, "novedades_page.html"), "w", encoding="utf-8") as f:
            f.write(content_html)

        # Save all captured API responses
        if api_responses:
            with open(os.path.join(OUTPUT_DIR, "novedades_api_capturadas.json"), "w", encoding="utf-8") as f:
                json.dump(api_responses, f, indent=2, ensure_ascii=False)
            print(f"   ✓ Capturadas {len(api_responses)} respuestas API de novedades.")

        # Extract DOM text elements of news cards
        cards = await page.locator("article, .card, [class*='news'], [class*='novedad'], [class*='post']").all_text_contents()
        print(f"   ✓ Encontradas {len(cards)} tarjetas de novedades en el DOM.")

        # Save structured summary
        summary = {
            "total_cards": len(cards),
            "cards_text": cards,
            "api_responses": api_responses
        }
        with open(os.path.join(OUTPUT_DIR, "novedades_resumen.json"), "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

        await browser.close()
        print(f"\n✅ Extracción de novedades finalizada. Archivos en carpeta '{OUTPUT_DIR}/'.")

if __name__ == "__main__":
    asyncio.run(main())
