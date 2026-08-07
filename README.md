# 📊 Consorcio Alvear 961/963 — Dashboard de Expensas y Auditoría Independiente

Panel de control, ingesta automática y auditoría de expensas, gastos y servicios para el consorcio **M. T. de Alvear 961/963** (CABA, Consorcio 996). 

---

## 🚀 Arquitectura y Tecnologías

* **Frontend:**
  * **HTML5 / Vanilla CSS (Variables CSS):** Diseño responsive de estética en modo oscuro.
  * **Vanilla JavaScript (ES6+):** Lógica pura para procesamiento de datos y filtrado dinámico.
  * **ApexCharts (CDN):** Visualizaciones interactivas de series temporales y rubros.
* **Backend de Ingesta & API Octopus:**
  * **download_octopus.py:** Ingestor de alto rendimiento integrado con la API REST de AWS de Octopus Vecinos (`https://vecinos.octopus.com.ar/`).
  * **extract_data.py:** Parser de comprobantes y balances para la generación de `gastos.json`.
  * **extract_prorrateo.py:** Parser de saldos y prorrateo por U.F. para la generación de `prorrateo.json`.
  * **check_servicios.py:** Script de monitoreo de interrupciones de Luz (Edesur), Agua (AySA) y Gas (Metrogas) en CABA.
  * **cron_update.py:** Coordinador inteligente de actualización automática.

---

## 📁 Estructura del Proyecto

```
Auditoria_Administracion_MTAlvear963/
├── .github/
│   └── workflows/
│       └── deploy.yml          # Workflow de CI/CD para GitHub Actions
├── liquidaciones/              # PDF descargados de Octopus
├── scratch/                    # Scripts de diagnóstico e inspección
├── check_servicios.py          # Script de monitoreo de Edesur, AySA y Metrogas
├── download_octopus.py         # Descargador automático vía API Octopus AWS
├── extract_data.py             # Parser principal de gastos y balances
├── extract_prorrateo.py        # Parser de expensas por U.F. e intereses
├── cron_update.py              # Coordinador de actualización y descargas
├── gastos.json                 # Base de datos consolidada de gastos
├── prorrateo.json              # Base de datos consolidada de U.F. e intereses
├── index.html                  # Panel de Control General de Gastos
├── dashboard.js                # Lógica del dashboard de gastos
├── unidades.html               # Panel de control de Unidades Funcionales
├── unidades.js                 # Lógica e interés por U.F.
├── cartelera_dashboard.html    # Cartelera para impresión
├── robots.txt                  # Directivas para buscadores
├── sitemap.xml                 # Mapa del sitio
└── README.md                   # Documentación técnica
```

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
