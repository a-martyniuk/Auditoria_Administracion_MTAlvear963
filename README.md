# 📊 Consorcio Alvear 961/963 — Dashboard de Expensas y Auditoría Independiente

Panel de control, ingesta automática y auditoría de expensas, gastos y servicios para el consorcio **M. T. de Alvear 961/963** (CABA, Consorcio 996). 

---

## 🚀 Arquitectura y Tecnologías

* **Frontend:**
  * **HTML5 / Vanilla CSS (Variables CSS):** Interfaz responsive modo oscuro con diseño mobile-first y tooltips flotantes en lenguaje claro.
  * **Vanilla JavaScript (ES6+):** Motores de auditoría de inflación IPC INDEC, discriminación de aguinaldos (SAC), clasificación Ordinarias vs. Extraordinarias y normalización de proveedores.
  * **ApexCharts (CDN):** Visualizaciones interactivas de series temporales y rubros.
* **Backend de Ingesta & API Octopus:**
  * **parse_official_expensas.py:** Parser principal de comprobantes y balances para la generación de `gastos.json` alineado a la Ley CABA 941.
  * **extract_prorrateo.py:** Parser de saldos y prorrateo por U.F. para la generación de `prorrateo.json` (100% de cobertura en 23 UFs).
  * **download_octopus.py:** Ingestor de alto rendimiento integrado con la API REST de AWS de Octopus Vecinos (`https://vecinos.octopus.com.ar/`).
  * **check_servicios.py:** Script de monitoreo preventivo de servicios públicos (Edesur, AySA y Metrogas).
  * **cron_update.py:** Coordinador inteligente de actualización automática.

---

## 📁 Estructura del Proyecto

```
Auditoria_Administracion_MTAlvear963/
├── index.html                   # Interfaz Principal (Cuadro de Mando, KPIs, Gráficos y Auditoría)
├── dashboard.js                 # Lógica de Negocio, Motores de Auditoría IPC y ApexCharts
├── unidades.html                # Interfaz de Unidades Funcionales (Prorrateo, Morosidad y Coeficientes)
├── unidades.js                  # Lógica de Prorrateo, Historial por UF y Auditoría de Intereses
├── cartelera_dashboard.html     # Plantilla A4 Imprimible para Cartelera del Edificio con Código QR
│
├── parse_official_expensas.py   # Motor Principal ETL: Extrae gastos desglosados y categoriza según CABA 941
├── extract_prorrateo.py         # Motor ETL Prorrateo: Extrae estados de cuenta de las 23 UFs
├── check_servicios.py           # Scraper de Servicios Públicos (Edesur, AySA, Metrogas)
├── cron_update.py               # Coordinador General de Ingesta Automatizada
├── download_octopus.py          # Cliente API/Scraper para la descarga de PDFs de liquidación
│
├── gastos.json                  # Dataset Consolidado de Gastos Auditados (+1.300 registros)
├── prorrateo.json               # Dataset Consolidado de Prorrateo y Morosidad (1.097 registros UF)
├── servicios_status.json        # Estado de Servicios Públicos en Tiempo Real
│
├── liquidaciones/               # Repositorio de PDFs Oficiales Auditados (2022-08 a 2026-07)
├── novedades/                   # Repositorio de Comunicados y Adjuntos del Consorcio
│
├── DOCUMENTACION_TECNICA.md     # Documentación Técnica Integral del Proyecto
├── README.md                    # Guía Rápida de Uso del Repositorio
├── vercel.json                  # Configuración de Rutas de Vercel
└── requirements.txt             # Dependencias del Entorno Python
```

---

## 📖 Documentación Técnica Completa

Para acceder al análisis detallado de la arquitectura de software, metodologías de auditoría, paridad IPC INDEC, reglas de negocio e instrucciones para desarrolladores, consulta el documento:

👉 **[DOCUMENTACION_TECNICA.md](DOCUMENTACION_TECNICA.md)**

---

## 🛠️ Instalación y Ejecución Local

Para ejecutar el proyecto localmente:

1. Clonar el repositorio.
2. Iniciar el servidor web local desde la raíz del proyecto para servir los datos estáticos:
   ```bash
   python -m http.server 8000
   ```
3. Abrir el navegador e ingresar a: `http://localhost:8000`

---

## 🔄 Ingesta y Actualización de Datos

Para ejecutar el proceso de ingesta y actualización de expensas manualmente:
```bash
python cron_update.py --all
```
