import asyncio
import base64
import json
import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OUTPUT_DIR = "novedades"
ATTACHMENTS_DIR = os.path.join(OUTPUT_DIR, "adjuntos")
os.makedirs(ATTACHMENTS_DIR, exist_ok=True)

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("Instalando playwright...")
    os.system("pip install playwright")
    from playwright.async_api import async_playwright

async def main():
    print("==================================================")
    print("📥 Extractor de Adjuntos Físicos mediante Clics y Descargas")
    print("==================================================")

    downloaded_urls = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(accept_downloads=True)
        page = await context.new_page()

        # Listen for any S3 or download URLs triggered in network
        async def handle_response(response):
            try:
                url = response.url
                if ("s3.amazonaws.com" in url or "files/" in url or ".pdf" in url or ".jpeg" in url or ".png" in url) and response.status == 200:
                    ct = response.headers.get("content-type", "")
                    if "pdf" in ct or "image" in ct or "octet-stream" in ct:
                        file_name = os.path.basename(url.split("?")[0])
                        if len(file_name) > 5 and file_name not in downloaded_urls:
                            file_bytes = await response.body()
                            if len(file_bytes) > 500:
                                target_path = os.path.join(ATTACHMENTS_DIR, file_name)
                                with open(target_path, "wb") as out_f:
                                    out_f.write(file_bytes)
                                print(f"   ✓ [Adjunto Capturado] -> {file_name} ({len(file_bytes)} bytes)")
                                downloaded_urls[file_name] = target_path
            except Exception:
                pass

        page.on("response", handle_response)

        # Handle explicit browser downloads
        async def handle_download(download):
            try:
                fn = download.suggested_filename
                target_path = os.path.join(ATTACHMENTS_DIR, fn)
                await download.save_as(target_path)
                print(f"   ✓ [Descarga Directa] -> {fn}")
                downloaded_urls[fn] = target_path
            except Exception:
                pass

        page.on("download", handle_download)

        print("\n1. Autenticando en Octopus...")
        await page.goto("https://vecinos.octopus.com.ar/login", wait_until="networkidle")
        await page.fill("input[type='email'], input[name='email']", os.environ.get("OCTOPUS_EMAIL", ""))
        await page.fill("input[type='password'], input[name='password']", os.environ.get("OCTOPUS_PASSWORD", ""))
        await page.locator("button:has-text('Iniciar'), button:has-text('Ingresar')").first.click()
        await page.wait_for_timeout(4000)

        print("\n2. Navegando a /news...")
        await page.goto("https://vecinos.octopus.com.ar/news", wait_until="networkidle")
        await page.wait_for_timeout(3000)

        # Scroll to load all cards
        for _ in range(5):
            await page.evaluate("window.scrollBy(0, 1000)")
            await page.wait_for_timeout(800)

        # Click all "Ver más" buttons
        ver_mas_buttons = await page.locator("button:has-text('Ver más'), a:has-text('Ver más'), span:has-text('Ver más')").all()
        print(f"   Encontrados {len(ver_mas_buttons)} botones 'Ver más'. Haciendo clic en todos...")

        for idx, btn in enumerate(ver_mas_buttons):
            try:
                await btn.scroll_into_view_if_needed()
                await btn.click()
                await page.wait_for_timeout(1000)
            except Exception:
                pass

        # Look for all attachment buttons/links inside modals or expanded cards
        dl_elements = await page.locator("a[href*='s3'], a[href*='files'], button:has-text('Descargar'), [class*='download'], a[target='_blank']").all()
        print(f"   Encontrados {len(dl_elements)} enlaces/botones de adjuntos en tarjetas expandidas. Haciendo clic...")

        for el in dl_elements:
            try:
                href = await el.get_attribute("href")
                if href and ("http" in href or "files" in href):
                    # Fetch inside browser page context
                    b64_data = await page.evaluate("""async (fileUrl) => {
                        try {
                            const resp = await fetch(fileUrl);
                            if (!resp.ok) return null;
                            const blob = await resp.blob();
                            return new Promise((resolve) => {
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                                reader.readAsDataURL(blob);
                            });
                        } catch (e) {
                            return null;
                        }
                    }""", href)

                    if b64_data:
                        file_bytes = base64.b64decode(b64_data)
                        fn = os.path.basename(href.split("?")[0])
                        if len(file_bytes) > 200 and fn:
                            target_path = os.path.join(ATTACHMENTS_DIR, fn)
                            with open(target_path, "wb") as out_f:
                                out_f.write(file_bytes)
                            print(f"   ✓ [Descargado por DOM] -> {fn} ({len(file_bytes)} bytes)")
                            downloaded_files[fn] = target_path
            except Exception:
                pass

        await browser.close()

    print(f"\n✅ Proceso finalizado. Total adjuntos descargados en 'novedades/adjuntos/': {len(os.listdir(ATTACHMENTS_DIR))}")

if __name__ == "__main__":
    asyncio.run(main())
