// Dashboard Alvear 961/963 — Lógica de auditoría ajustada 100% a los 10 rubros oficiales de la liquidación

let rawExpenses = [];
let rawComprobantes = [];
let rawBalances = [];
let rawMultas = [];
let rawProrrateo = [];
let filteredExpenses = [];
let currentPage = 1;
let pageSize = 20;
let ipcData = {};
let currentViewMode = "DESGLOSADO";

// Chart instances
let chartHistorical = null;
let chartCategory = null;
let chartComparison = null;
let chartPatrimonial = null;
let chartEmployee = null;
let chartDrillSueldos = null, chartDrillServicios = null, chartDrillContratos = null;
let chartDrillManto = null, chartDrillReparaciones = null, chartDrillBanco = null;
let chartDrillLimpieza = null, chartDrillAdmin = null, chartDrillSeguros = null, chartDrillVarios = null;

function getConceptGroup(e) {
    if (!e) return "Gastos Varios";
    const conc = ((e.concepto || "") + " " + (e.proveedor || "")).trim();
    const lower = conc.toLowerCase();

    if (lower.includes("edesur")) return "Edesur SA";
    if (lower.includes("aysa")) return "AySA";
    if (lower.includes("metrogas")) return "Metrogas";
    if (lower.includes("personal") || lower.includes("telecom") || lower.includes("iplan")) return "Personal / Telecom";
    if (lower.includes("ferazzoli") || lower.includes("adm-vf") || lower.includes("honorarios adm")) return "Adm. Verónica Ferazzoli";
    if (lower.includes("sueldo básico") || lower.includes("sueldo basico")) return "Sueldo Básico";
    if (lower.includes("antigüedad") || lower.includes("antiguedad")) return "Antigüedad";
    if (lower.includes("sac") || lower.includes("sueldo anual")) return "SAC Aguinaldo";
    if (lower.includes("afip") || lower.includes("f 931") || lower.includes("cargas sociales")) return "AFIP / Cargas Sociales";
    if (lower.includes("suterh") || lower.includes("fateryh") || lower.includes("seracarh") || lower.includes("sindicato")) return "SUTERH / FATERYH";
    if (lower.includes("octopus")) return "Plataforma Octopus";
    if (lower.includes("noplag")) return "Noplag Control Plagas";
    if (lower.includes("asegal")) return "Asegal SRL";
    if (lower.includes("geas")) return "Geas Mantenimiento";
    if (lower.includes("banco") || lower.includes("itaú") || lower.includes("macro") || lower.includes("comision")) return "Gastos Bancarios";
    if (lower.includes("seguro")) return "Seguros del Edificio";
    if (lower.includes("dalla valle")) return "Dalla Valle Porteros";
    if (lower.includes("cerrajeria") || lower.includes("hugo")) return "Cerrajería Hugo";
    if (lower.includes("ramos matias")) return "Ramos Matías";
    if (lower.includes("ocampos")) return "Ocampos Abel Ascensores";
    if (lower.includes("santoandre")) return "Santoandre Nicolás";
    if (lower.includes("centro-grafico") || lower.includes("centro grafico")) return "Centro Gráfico";
    if (lower.includes("gestionar")) return "Gestionar Expedientes";

    let raw = (e.proveedor && e.proveedor !== "S/D") ? e.proveedor : e.concepto;
    let vendorName = (raw || "").split("–")[0].split("-")[0].trim();
    vendorName = vendorName.replace(/^\d+[\s\.\-]+/, '').trim();
    return vendorName.slice(0, 25) || "Gastos Varios";
}
window.getConceptGroup = getConceptGroup;

// Helper: calcula la ventana de 12 meses (11 meses anteriores + período seleccionado/último)
const get12PeriodsWindow = (targetPeriod, allPeriods) => {
    if (!allPeriods || allPeriods.length === 0) return [];
    if (!targetPeriod || targetPeriod === "todos") {
        return allPeriods.slice(-12);
    }
    const idx = allPeriods.indexOf(targetPeriod);
    if (idx === -1) return allPeriods.slice(-12);
    return allPeriods.slice(Math.max(0, idx - 11), idx + 1);
};

// ── Fetch inflación oficial del INDEC (IPC) ────────────────────
const fetchIPC = async () => {
    try {
        const r = await fetch("https://apis.datos.gob.ar/series/api/series?ids=103.1_I2N_2016_M_15&collapse=month&limit=500&format=json");
        const json = await r.json();
        const dataRows = json.data || [];
        for (let i = 0; i < dataRows.length; i++) {
            const dateStr = dataRows[i][0];
            const val = dataRows[i][1];
            const p = dateStr.slice(0, 7);
            let inflacion = null;
            if (i > 0) {
                const prevVal = dataRows[i - 1][1];
                if (prevVal > 0) {
                    inflacion = ((val - prevVal) / prevVal) * 100;
                }
            }
            ipcData[p] = { valor: val, inflacion };
        }

        const periods = Object.keys(ipcData).sort();
        if (periods.length > 0) {
            let lastPeriod = periods[periods.length - 1];
            let lastVal = ipcData[lastPeriod].valor;
            let [y, m] = lastPeriod.split("-").map(Number);
            const limitYear = 2026;
            const limitMonth = 7;

            while (y < limitYear || (y === limitYear && m < limitMonth)) {
                m++;
                if (m > 12) { m = 1; y++; }
                const nextPeriod = `${y}-${String(m).padStart(2, '0')}`;
                const projectedInf = 4.2;
                lastVal = lastVal * (1 + projectedInf / 100);
                ipcData[nextPeriod] = { valor: lastVal, inflacion: projectedInf };
            }
        }
    } catch (e) {
        console.warn("No se pudo cargar la API de inflación oficial (IPC):", e);
    }
};

// ── Formatters ─────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0
}).format(n || 0);

const fmtFull = (n) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 2
}).format(n || 0);

const normalizeRubro = (r) => {
    if (!r) return "Otros";

    let clean = r.toString().trim();
    // Remove leading category numbers: e.g. "1 ", "01 ", "1 - ", "1.", etc.
    clean = clean.replace(/^\d+[\s\.\-]+/, '').trim();

    const lower = clean.toLowerCase();

    if (lower.includes("sueldo") || lower.includes("remuneracion") || lower.includes("remuneración") || lower.includes("cargas sociales") || lower.includes("aportes")) return "Sueldos y Aportes";
    if (lower.includes("servicio") && (lower.includes("público") || lower.includes("publico"))) return "Servicios Públicos";
    if (lower.includes("abono") || lower.includes("contrato")) return "Abonos de Servicios";
    if (lower.includes("mantenimiento") || lower.includes("partes comunes")) return "Mantenimiento de Partes Comunes";
    if (lower.includes("unidades funcionales") || lower.includes("unidad funcional") || lower.includes("reparación en unidad") || lower.includes("reparacion en unidad")) return "Trabajos de Reparación en Unidades Funcionales";
    if (lower.includes("bancario") || lower.includes("banco")) return "Gastos Bancarios";
    if (lower.includes("limpieza")) return "Gastos de Limpieza";
    if (lower.includes("administrac")) return "Gastos de Administración";
    if (lower.includes("seguro")) return "Pagos del Período por Seguros";
    if (lower.includes("otro") || lower.includes("varios")) return "Otros";

    return clean || "Otros";
};

// ── 10 RUBROS OFICIALES SEGÚN LIQUIDACIÓN DE EXPENSAS ───────────
const CAT_CONFIG = {
    "Sueldos y Aportes":                             { cls: "pill-sueldos",   icon: "👤", dot: "#f87171" },
    "Servicios Públicos":                           { cls: "pill-servicios", icon: "⚡", dot: "#fbbf24" },
    "Abonos de Servicios":                           { cls: "pill-contratos", icon: "🛠️", dot: "#34d399" },
    "Mantenimiento de Partes Comunes":               { cls: "pill-manto",    icon: "🔧", dot: "#a78bfa" },
    "Trabajos de Reparación en Unidades Funcionales":{ cls: "pill-manto",    icon: "🏠", dot: "#e879f9" },
    "Gastos Bancarios":                              { cls: "pill-admin",     icon: "🏛️", dot: "#38bdf8" },
    "Gastos de Limpieza":                            { cls: "pill-manto",    icon: "🧹", dot: "#818cf8" },
    "Gastos de Administración":                      { cls: "pill-admin",     icon: "📋", dot: "#60a5fa" },
    "Pagos del Período por Seguros":                 { cls: "pill-contratos", icon: "🛡️", dot: "#4ade80" },
    "Otros":                                         { cls: "pill-varios",    icon: "📦", dot: "#9ca3af" },
    "Liquidación Mensual de Expensas":              { cls: "pill-admin",     icon: "🏢", dot: "#06b6d4" },
};

const getCatPill = (rubro) => {
    const norm = normalizeRubro(rubro);
    const cfg = CAT_CONFIG[norm] || { cls: "pill-varios", icon: "•", dot: "#9ca3af" };
    return `<span class="pill ${cfg.cls}">${cfg.icon} ${norm}</span>`;
};

const getAssetUrl = (filename) => {
    let loc = window.location.href.split('?')[0].split('#')[0];
    if (!loc.endsWith('/')) {
        if (loc.endsWith('.html')) {
            loc = loc.substring(0, loc.lastIndexOf('/') + 1);
        } else {
            loc = loc + '/';
        }
    }
    return new URL(filename, loc).href;
};

// ── BOOTSTRAP ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    fetchIPC().catch(err => console.warn("IPC deferred:", err));

    Promise.all([
        fetch(getAssetUrl("gastos.json")).then(r => r.json()),
        fetch(getAssetUrl("prorrateo.json")).then(r => r.json()).catch(() => ({}))
    ])
    .then(([data, prorrateoData]) => {
        const rawList = data.gastos || [];
        rawList.forEach(e => { e.rubro = normalizeRubro(e.rubro); });

        // Consolidar desgloses parciales del mismo concepto en el mismo período (evita renglones fragmentados por desgloses de SAC)
        const consMap = {};
        rawList.forEach(e => {
            const p = e.periodo;
            const r = e.rubro;
            const c = (e.concepto || "").trim();
            const key = `${p}___${r}___${c.toLowerCase()}`;
            if (!consMap[key]) {
                consMap[key] = { ...e };
            } else {
                consMap[key].monto += e.monto;
            }
        });
        rawExpenses = Object.values(consMap);

        rawComprobantes = data.comprobantes || [];
        rawBalances = data.balances || [];
        rawMultas = data.multas || [];

        const allProrrateo = [];
        if (prorrateoData && typeof prorrateoData === 'object') {
            Object.keys(prorrateoData).forEach(p => {
                if (Array.isArray(prorrateoData[p])) {
                    prorrateoData[p].forEach(item => {
                        allProrrateo.push({ ...item, periodo: p });
                    });
                }
            });
        }
        rawProrrateo = allProrrateo;

        rawComprobantes.forEach(e => { e.rubro = normalizeRubro(e.rubro); });
        rawExpenses.sort((a, b) => a.periodo.localeCompare(b.periodo));

        // Construir mapa de montos por periodo y concepto (sumando parciales si existen)
        const periodMap = {};
        rawExpenses.forEach(e => {
            const p = e.periodo;
            if (!periodMap[p]) periodMap[p] = {};
            const key = ((e.proveedor || e.concepto) || "").toLowerCase().slice(0, 30);
            periodMap[p][key] = (periodMap[p][key] || 0) + e.monto;
        });

        const isSacItem = (concepto) => {
            const c = (concepto || "").toLowerCase();
            return c.includes("sac") || c.includes("aguinaldo") || c.includes("sueldo anual");
        };

        const isLaborItem = (concepto) => {
            const c = (concepto || "").toLowerCase();
            return c.includes("f 931") || c.includes("f.931") || c.includes("suterh") || c.includes("fateryh") || c.includes("jubilac") || c.includes("pami") || c.includes("obra social") || c.includes("caja protecci") || c.includes("cuota sindical");
        };

        const getPrevPeriod = (pStr, isSac, isLabor) => {
            if (!pStr || pStr.length < 7) return "";
            const y = parseInt(pStr.slice(0, 4), 10);
            const m = parseInt(pStr.slice(5, 7), 10);

            if (isSac) {
                if (m === 6 || m === 7) return `${y - 1}-12`;
                if (m === 12 || m === 1) return `${y}-07`;
                return `${y - 1}-12`;
            }

            if (isLabor) {
                if (m === 7) return `${y}-05`;
                if (m === 8) return `${y}-05`;
                if (m === 12 || m === 1) return `${y - 1}-11`;
            }

            if (m === 1) return `${y - 1}-12`;
            return `${y}-${String(m - 1).padStart(2, '0')}`;
        };

        rawExpenses.forEach(e => {
            const lowerKey = ((e.proveedor || e.concepto) || "").toLowerCase();
            const key = lowerKey.slice(0, 30);
            const isSac = isSacItem(lowerKey);
            const isLabor = isLaborItem(lowerKey);
            const prevP = getPrevPeriod(e.periodo, isSac, isLabor);

            const montoAnt = (periodMap[prevP] && periodMap[prevP][key]) ? periodMap[prevP][key] : 0;
            e.monto_anterior = montoAnt;

            const m = parseInt(e.periodo.slice(5, 7), 10);
            const isSacMonth = (m === 6 || m === 7 || m === 12 || m === 1);

            if (montoAnt > 0) {
                const diffPct = Math.round(((e.monto - montoAnt) / montoAnt) * 100);
                e.desviacion_pct = diffPct;
                e.anomalia = (diffPct >= 50 && !isSac && !(isLabor && isSacMonth) && e.monto > 15000);
            } else {
                e.desviacion_pct = 0;
                e.anomalia = false;
            }
        });

        populatePeriodFilter();
        setupEventListeners();
        applyFilter();
        loadServicesStatus();
    })
        .catch(err => {
            console.error("Error al cargar gastos.json:", err);
            document.getElementById("expensesTableBody").innerHTML =
                `<tr><td colspan="7" style="text-align:center;color:#f87171;padding:2rem;">
                    Error al cargar los datos. Asegurate de ejecutar con un servidor local.
                </td></tr>`;
        });
});

// ── Period Filter Dropdown ──────────────────────────────────────
const populatePeriodFilter = () => {
    const sel = document.getElementById("periodFilter");
    if (!sel) return;
    const periods = [...new Set(rawBalances.map(b => b.periodo))].sort().reverse();

    sel.innerHTML = `<option value="todos">Histórico Completo (${periods.length} Períodos)</option>`;
    periods.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p; opt.textContent = p;
        sel.appendChild(opt);
    });

    if (periods.length > 0) {
        sel.value = periods[0];
    }

    const sidebarSpan = document.getElementById("sidebarPeriods");
    if (sidebarSpan && periods.length > 0) {
        sidebarSpan.textContent = `${periods.length} meses auditados (${periods[periods.length - 1]} a ${periods[0]})`;
    }
};

// ── Apply Filter Logic ──────────────────────────────────────────
const applyFilter = () => {
    const periodSel = document.getElementById("periodFilter");
    const searchInp = document.getElementById("searchInput");
    const modeSel = document.getElementById("viewModeSelect");
    const statusSel = document.getElementById("statusFilter");

    currentViewMode = modeSel ? modeSel.value : "DESGLOSADO";
    const period = periodSel ? periodSel.value : "todos";
    const status = statusSel ? statusSel.value : "todos";
    const query = searchInp ? searchInp.value.toLowerCase().trim() : "";

    let sourceDataset = rawExpenses;
    if (currentViewMode === "COMPROBANTES") {
        sourceDataset = rawComprobantes;
    } else if (currentViewMode === "LIQUIDACIONES") {
        sourceDataset = rawBalances.map(b => ({
            periodo: b.periodo,
            rubro: "Liquidación Mensual de Expensas",
            concepto: `Liquidación Total Expensas Período ${b.periodo}`,
            tipo: "Fijo",
            monto: b.monto_expensa,
            archivo: `${b.periodo}_expensa_oficial.pdf`
        }));
    }

    filteredExpenses = sourceDataset.filter(e => {
        const okPeriod = period === "todos" || e.periodo === period;
        const okStatus = status === "todos" || (e.estado && e.estado === status) || (!e.estado && status === "Pagado");
        const okSearch = !query ||
            (e.concepto && e.concepto.toLowerCase().includes(query)) ||
            (e.rubro && e.rubro.toLowerCase().includes(query));
        return okPeriod && okStatus && okSearch;
    });

    currentPage = 1;
    updateDashboard(period);
};

// ── Event Listeners ─────────────────────────────────────────────
const setupEventListeners = () => {
    const periodSel = document.getElementById("periodFilter");
    const searchInp = document.getElementById("searchInput");
    const modeSel = document.getElementById("viewModeSelect");
    const statusSel = document.getElementById("statusFilter");
    const pageSizeSel = document.getElementById("pageSizeSelect");

    if (periodSel) periodSel.addEventListener("change", applyFilter);
    if (searchInp) searchInp.addEventListener("input", applyFilter);
    if (modeSel) modeSel.addEventListener("change", applyFilter);
    if (statusSel) statusSel.addEventListener("change", applyFilter);
    if (pageSizeSel) {
        pageSizeSel.addEventListener("change", () => {
            pageSize = parseInt(pageSizeSel.value);
            currentPage = 1;
            renderTable();
        });
    }
};

// ── Master Dashboard Update ─────────────────────────────────────
const updateDashboard = (period) => {
    renderKPIs(period);
    renderNarrative(period);
    renderAnomalies(period);
    renderHistoricalChart(period);
    renderCategoryChart();
    renderComparisonChart(period);
    renderPatrimonialChart(period);
    auditProviders(period);
    renderDrilldownCharts(period);
    renderEmployeeKPIs(period);
    renderEmployeeChart(period);
    renderFines(period);
    renderTable();
    renderMissingInvoices();
    loadServicesStatus();
};

const renderKPIs = (period) => {
    const searchVal = (document.getElementById("searchInput")?.value || "").trim();
    const statusVal = (document.getElementById("statusFilter")?.value || "todos");
    const isFiltered = searchVal !== "" || statusVal !== "todos";

    const balance = rawBalances.find(b => b.periodo === period);
    const totalRecaudado = balance ? balance.monto_expensa : (period === "todos" ? rawBalances.reduce((s, b) => s + b.monto_expensa, 0) : 0);
    const totalEgresos = isFiltered ? filteredExpenses.reduce((sum, g) => sum + g.monto, 0) : totalRecaudado;

    // UF 001 (SAS) representa el 38.58% del total de expensas.
    // El 61.42% restante corresponde a las 22 Unidades Funcionales residenciales (Deptos 1 a 23).
    const totalDeptos = totalRecaudado * (1 - 0.3858);
    const promDeptos = totalRecaudado > 0 ? totalDeptos / 22 : 0;
    const promGeneral = totalRecaudado > 0 ? totalRecaudado / 23 : 0;

    const countAnomalias = rawExpenses.filter(g => (period === "todos" || g.periodo === period) && g.anomalia).length;

    const elRecaudado = document.getElementById("kpiRecaudado");
    const elEgresado = document.getElementById("kpiEgresado");
    const elProm = document.getElementById("kpiPromedio");
    const elPromDelta = document.getElementById("kpiPromedioDelta");
    const elAnom = document.getElementById("kpiAnomalias");

    if (elRecaudado) elRecaudado.innerText = fmtFull(totalRecaudado);
    if (elEgresado) elEgresado.innerText = fmtFull(totalEgresos);
    if (elProm) elProm.innerText = fmtFull(promDeptos);
    if (elPromDelta) elPromDelta.innerText = `Cuota media 22 deptos (Excl. UF 1 SAS 38.58%). Prom. total 23 UF: ${fmtFull(promGeneral)}`;
    if (elAnom) elAnom.innerText = countAnomalias;
};

const renderNarrative = (period) => {
    const block = document.getElementById("narrativeBlock");
    if (!block) return;

    if (period === "todos") {
        const totalHistorico = rawBalances.reduce((s, b) => s + b.monto_expensa, 0);
        block.innerHTML = `
            📌 <strong>Histórico Completo de Auditoría:</strong> Se han auditado <strong>${rawBalances.length} períodos de expensas</strong> acumulando una masa total de liquidaciones por <strong>${fmtFull(totalHistorico)}</strong>.
            Consorcio Alvear 961/963 (Retiro, CABA — 23 U.F.).
        `;
    } else {
        const b = rawBalances.find(x => x.periodo === period) || {};
        const totalMonto = b.monto_expensa || filteredExpenses.reduce((s, e) => s + e.monto, 0);
        const uf1Monto = totalMonto * 0.3858;
        const promDeptos = (totalMonto * 0.6142) / 22;
        const promGeneral = totalMonto / 23;
        const venc1 = b.vencimiento_1 ? new Date(b.vencimiento_1).toLocaleDateString("es-AR") : "Consultar liquidación";
        const countAnomalias = rawExpenses.filter(g => g.periodo === period && g.anomalia).length;
        block.innerHTML = `
            📌 <strong>Auditoría del Período ${period}:</strong> La liquidación total de expensas asciende a <strong>${fmtFull(totalMonto)}</strong>. 
            Promedio por Depto (22 UFs): <strong>${fmtFull(promDeptos)}</strong> <span style="font-size:0.82rem; opacity:0.85;">(Excl. UF 001 SAS: ${fmtFull(uf1Monto)} [38,58%] \| Prom. gral 23 UFs: ${fmtFull(promGeneral)})</span>. 
            Vencimiento fijado para el <span class="hl">${venc1}</span>. 
            ${countAnomalias > 0 ? `<span style="color:#f43f5e; font-weight:700;">⚠️ Se detectaron ${countAnomalias} alertas de desvío en este período.</span>` : `✅ Todos los costos auditados se encuentran dentro de los parámetros normales.`}
        `;
    }
};

// ── ANOMALIES MANAGEMENT SYSTEM ────────────────────────────────
let dismissedAnomalies = new Set(JSON.parse(localStorage.getItem("dismissed_anomalies_alvear") || "[]"));
let minDeviationThreshold = 50;
let showDismissedAnomalies = false;
let anomaliesCollapsed = false;
let showAllAnomalies = false;

function saveDismissedAnomalies() {
    localStorage.setItem("dismissed_anomalies_alvear", JSON.stringify([...dismissedAnomalies]));
}

function dismissAnomaly(key) {
    dismissedAnomalies.add(key);
    saveDismissedAnomalies();
    const periodSel = document.getElementById("periodFilter");
    renderAnomalies(periodSel ? periodSel.value : "todos");
}

function restoreAnomaly(key) {
    dismissedAnomalies.delete(key);
    saveDismissedAnomalies();
    const periodSel = document.getElementById("periodFilter");
    renderAnomalies(periodSel ? periodSel.value : "todos");
}

function resetAllDismissedAnomalies() {
    dismissedAnomalies.clear();
    saveDismissedAnomalies();
    const periodSel = document.getElementById("periodFilter");
    renderAnomalies(periodSel ? periodSel.value : "todos");
}

function setMinDeviationThreshold(thresh) {
    minDeviationThreshold = thresh;
    const periodSel = document.getElementById("periodFilter");
    renderAnomalies(periodSel ? periodSel.value : "todos");
}

function toggleShowDismissed() {
    showDismissedAnomalies = !showDismissedAnomalies;
    const periodSel = document.getElementById("periodFilter");
    renderAnomalies(periodSel ? periodSel.value : "todos");
}

function toggleAnomaliesCollapse() {
    anomaliesCollapsed = !anomaliesCollapsed;
    const periodSel = document.getElementById("periodFilter");
    renderAnomalies(periodSel ? periodSel.value : "todos");
}

function toggleAnomaliesView() {
    showAllAnomalies = !showAllAnomalies;
    const periodSel = document.getElementById("periodFilter");
    renderAnomalies(periodSel ? periodSel.value : "todos");
}

const renderAnomalies = (period) => {
    const sec = document.getElementById("anomalySection");
    if (!sec) return;

    let allAnomalias = rawExpenses.filter(g => (period === "todos" || g.periodo === period) && g.anomalia);

    if (allAnomalias.length === 0) {
        sec.style.display = "none";
        return;
    }

    let filtered = allAnomalias.filter(g => (g.desviacion_pct || 0) >= minDeviationThreshold);

    const getAnomalyKey = g => `${g.periodo}_${g.concepto}_${g.monto}`;
    let active = filtered.filter(g => !dismissedAnomalies.has(getAnomalyKey(g)));
    let dismissed = filtered.filter(g => dismissedAnomalies.has(getAnomalyKey(g)));

    let displayList = showDismissedAnomalies ? filtered : active;
    displayList.sort((a, b) => b.desviacion_pct - a.desviacion_pct);

    sec.style.display = "block";
    sec.style.background = "var(--bg-card)";
    sec.style.border = "1px solid var(--border-accent)";
    sec.style.borderRadius = "14px";
    sec.style.padding = "1rem 1.25rem";
    sec.style.marginBottom = "1.5rem";

    const totalActiveCount = active.length;
    const totalDismissedCount = dismissed.length;

    let html = `
        <div class="anomaly-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; border-bottom: ${anomaliesCollapsed ? 'none' : '1px solid var(--border)'}; padding-bottom:${anomaliesCollapsed ? '0' : '0.75rem'}; margin-bottom:${anomaliesCollapsed ? '0' : '0.75rem'};">
            <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:1.1rem;">⚠️</span>
                <strong style="font-size:1rem; font-family:'Outfit', sans-serif; color:var(--text-1);">
                    Alertas de Variación Detectadas
                    <span style="font-size:0.78rem; font-weight:600; color:${totalActiveCount > 0 ? '#f87171' : '#10b981'}; background:rgba(244,63,94,0.12); padding:2px 8px; border-radius:99px; margin-left:6px;">
                        ${totalActiveCount} activa${totalActiveCount !== 1 ? 's' : ''}
                    </span>
                    ${totalDismissedCount > 0 ? `<span style="font-size:0.75rem; color:var(--text-3); margin-left:4px;">(${totalDismissedCount} descartada${totalDismissedCount !== 1 ? 's' : ''})</span>` : ''}
                </strong>
            </div>

            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <div style="display:inline-flex; border:1px solid var(--border); border-radius:6px; overflow:hidden; font-size:0.75rem;">
                    <button type="button" onclick="setMinDeviationThreshold(50)" style="padding:3px 7px; background:${minDeviationThreshold===50?'var(--accent-dim)':'transparent'}; color:${minDeviationThreshold===50?'var(--accent)':'var(--text-2)'}; border:none; cursor:pointer;">>50%</button>
                    <button type="button" onclick="setMinDeviationThreshold(75)" style="padding:3px 7px; background:${minDeviationThreshold===75?'var(--accent-dim)':'transparent'}; color:${minDeviationThreshold===75?'var(--accent)':'var(--text-2)'}; border:none; cursor:pointer;">>75%</button>
                    <button type="button" onclick="setMinDeviationThreshold(100)" style="padding:3px 7px; background:${minDeviationThreshold===100?'var(--accent-dim)':'transparent'}; color:${minDeviationThreshold===100?'var(--accent)':'var(--text-2)'}; border:none; cursor:pointer;">>100%</button>
                </div>

                ${totalDismissedCount > 0 ? `
                    <button type="button" onclick="toggleShowDismissed()" style="font-size:0.72rem; padding:3px 8px; background:rgba(100,116,139,0.15); border:1px solid var(--border); border-radius:6px; color:var(--text-2); cursor:pointer;">
                        ${showDismissedAnomalies ? '🙈 Ocultar Descartadas' : `👁️ Ver Descartadas (${totalDismissedCount})`}
                    </button>
                    <button type="button" onclick="resetAllDismissedAnomalies()" title="Restablecer todas las alertas descartadas" style="font-size:0.72rem; padding:3px 6px; background:transparent; border:1px solid var(--border); border-radius:6px; color:var(--text-3); cursor:pointer;">
                        🔄 Restablecer
                    </button>
                ` : ''}

                <button type="button" onclick="toggleAnomaliesCollapse()" style="font-size:0.75rem; padding:3px 8px; background:rgba(6,182,212,0.1); border:1px solid var(--border-accent); border-radius:6px; color:var(--accent); cursor:pointer;">
                    ${anomaliesCollapsed ? '🔽 Expandir' : '🔼 Plegar'}
                </button>
            </div>
        </div>
    `;

    if (!anomaliesCollapsed) {
        if (displayList.length === 0) {
            html += `<div style="text-align:center; padding:1rem; color:var(--text-3); font-size:0.85rem;">
                ✓ No hay alertas activas para los criterios seleccionados. ${totalDismissedCount > 0 ? `(${totalDismissedCount} alertas están descartadas)` : ''}
            </div>`;
        } else {
            const currentDisplay = showAllAnomalies ? displayList : displayList.slice(0, 5);

            html += `
                <div id="anomalyContainer" style="max-height: 280px; overflow-y: auto; padding-right: 4px; display:flex; flex-direction:column; gap:0.4rem;">
                    ${currentDisplay.map(a => {
                        const key = getAnomalyKey(a);
                        const isDismissed = dismissedAnomalies.has(key);
                        const safeKey = key.replace(/['"\\]/g, "");
                        return `
                            <div style="background:${isDismissed ? 'rgba(255,255,255,0.02)' : 'rgba(244,63,94,0.06)'}; border:1px solid ${isDismissed ? 'var(--border)' : 'rgba(244,63,94,0.25)'}; border-radius:8px; padding:0.6rem 0.85rem; display:flex; justify-content:space-between; align-items:center; opacity:${isDismissed ? 0.65 : 1};">
                                <div style="flex:1; min-width:0; padding-right:1rem;">
                                    <div style="font-size:0.88rem; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; color:var(--text-1);">
                                        <span style="color:var(--accent); font-weight:700;">[${a.periodo}]</span> ${a.concepto}
                                    </div>
                                    <div style="font-size:0.75rem; color:var(--text-3); margin-top:2px;">
                                        Rubro: <strong style="color:var(--text-2);">${a.rubro}</strong>
                                    </div>
                                </div>
                                <div style="display:flex; align-items:center; gap:0.75rem;">
                                    <div style="text-align:right;">
                                        <span class="badge" style="background:${isDismissed ? 'rgba(100,116,139,0.2)' : 'rgba(244,63,94,0.18)'}; color:${isDismissed ? 'var(--text-3)' : '#f87171'}; font-weight:700;">+${a.desviacion_pct}% Desvío</span>
                                        <div style="font-weight:700; font-size:0.9rem; margin-top:2px; color:var(--text-1);">${fmtFull(a.monto)}</div>
                                    </div>
                                    <div>
                                        ${isDismissed ? `
                                            <button type="button" onclick="restoreAnomaly('${safeKey}')" title="Restaurar alerta" style="background:none; border:none; cursor:pointer; font-size:1rem; opacity:0.7;">↩️</button>
                                        ` : `
                                            <button type="button" onclick="dismissAnomaly('${safeKey}')" title="Marcar como revisada / descartar" style="background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.3); border-radius:6px; color:#34d399; padding:4px 8px; font-size:0.75rem; font-weight:600; cursor:pointer;">
                                                ✓ Revisada
                                            </button>
                                        `}
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join("")}
                </div>

                ${displayList.length > 5 ? `
                    <div style="text-align:center; margin-top:0.75rem; border-top:1px solid var(--border); padding-top:0.5rem;">
                        <button type="button" onclick="toggleAnomaliesView()" style="font-size:0.75rem; padding:4px 12px; background:rgba(244,63,94,0.12); border:1px solid rgba(244,63,94,0.3); border-radius:6px; color:#f87171; font-weight:600; cursor:pointer;">
                            ${showAllAnomalies ? '🔼 Mostrar solo Top 5 Alertas' : `👁️ Ver todas las ${displayList.length} alertas`}
                        </button>
                    </div>
                ` : ''}
            `;
        }
    }

    sec.innerHTML = html;
};

// ── CHARTS ─────────────────────────────────────────────────────
const renderHistoricalChart = (targetPeriod) => {
    const balancesSorted = [...rawBalances].sort((a, b) => a.periodo.localeCompare(b.periodo));
    const allCategories = balancesSorted.map(b => b.periodo);
    const seriesData = allCategories.map(p => {
        const b = balancesSorted.find(x => x.periodo === p);
        return b ? (b.monto_expensa || 0) : 0;
    });

    const totalCount = allCategories.length;
    const minIndex = Math.max(1, totalCount - 11);
    const maxIndex = totalCount;

    const elHist = document.querySelector("#historicalChart");
    if (elHist && typeof ApexCharts !== "undefined") {
        const opts1 = {
            series: [{ name: 'Expensa Mensual Total', data: seriesData }],
            chart: {
                type: 'area',
                height: 280,
                foreColor: '#94a3b8',
                toolbar: {
                    show: true,
                    tools: {
                        download: false,
                        selection: false,
                        zoom: true,
                        zoomin: true,
                        zoomout: true,
                        pan: true,
                        reset: true
                    }
                },
                zoom: {
                    enabled: true,
                    type: 'x',
                    autoScaleYaxis: true
                },
                background: 'transparent',
                fontFamily: 'Inter, sans-serif'
            },
            colors: ['#06b6d4'],
            theme: { mode: 'dark' },
            stroke: { curve: 'smooth', width: 2 },
            fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05 } },
            dataLabels: { enabled: false },
            xaxis: {
                type: 'category',
                tickPlacement: 'on',
                categories: allCategories,
                min: minIndex,
                max: maxIndex,
                axisBorder: { show: false },
                axisTicks: { show: false },
                labels: { rotate: -30, style: { fontSize: '10px' } }
            },
            yaxis: { labels: { style: { colors: '#94a3b8' }, formatter: (v) => fmt(v) } },
            grid: { borderColor: 'rgba(255,255,255,0.05)' },
            tooltip: { theme: 'dark', y: { formatter: (val) => fmtFull(val) } }
        };

        if (chartHistorical) chartHistorical.destroy();
        chartHistorical = new ApexCharts(elHist, opts1);
        chartHistorical.render().then(() => {
            setTimeout(() => {
                if (chartHistorical) chartHistorical.zoomX(minIndex, maxIndex);
            }, 100);
        });
    }
};

const renderCategoryChart = () => {
    const periodSel = document.getElementById("periodFilter");
    const period = periodSel ? periodSel.value : "todos";

    let targetDataset = currentViewMode === "DESGLOSADO" ? rawExpenses : rawComprobantes;
    if (period === "todos") {
        const latestP = rawBalances[0]?.periodo || targetDataset[0]?.periodo;
        targetDataset = targetDataset.filter(g => g.periodo === latestP);
    } else {
        targetDataset = targetDataset.filter(g => g.periodo === period);
    }

    const rubroTotals = {};
    targetDataset.forEach(g => {
        if (g.monto > 0) {
            const norm = normalizeRubro(g.rubro);
            rubroTotals[norm] = (rubroTotals[norm] || 0) + g.monto;
        }
    });

    const rubroLabels = Object.keys(rubroTotals);
    const rubroValues = Object.values(rubroTotals);

    const elCat = document.querySelector("#categoryChart");
    if (elCat && typeof ApexCharts !== "undefined") {
        const opts2 = {
            chart: { type: 'donut', height: 280, background: 'transparent', fontFamily: 'Inter, sans-serif' },
            theme: { mode: 'dark' },
            colors: ['#06b6d4', '#10b981', '#f59e0b', '#a78bfa', '#60a5fa', '#f43f5e', '#64748b', '#e879f9', '#818cf8', '#38bdf8'],
            series: rubroValues.length ? rubroValues : [1],
            labels: rubroLabels.length ? rubroLabels : ['Liquidación Mensual'],
            legend: { position: 'bottom', labels: { colors: '#94a3b8' } },
            dataLabels: { enabled: false },
            tooltip: { theme: 'dark', y: { formatter: (val) => fmtFull(val) } }
        };

        if (chartCategory) chartCategory.destroy();
        chartCategory = new ApexCharts(elCat, opts2);
        chartCategory.render();
    }
};

const renderComparisonChart = (targetPeriod) => {
    const balancesSorted = [...rawBalances].sort((a, b) => a.periodo.localeCompare(b.periodo));
    const allCategories = balancesSorted.map(b => b.periodo);
    const cats = Object.keys(CAT_CONFIG);

    const seriesComp = cats.map(cat => ({
        name: cat,
        data: allCategories.map(p =>
            Math.round(rawExpenses.filter(e => e.periodo === p && normalizeRubro(e.rubro) === cat)
                .reduce((a, e) => a + (e.monto || 0), 0))
        )
    })).filter(s => s.data.some(v => v > 0));

    const barColors = seriesComp.map(s => (CAT_CONFIG[s.name] ? CAT_CONFIG[s.name].dot : "#9ca3af"));
    const totalCount = allCategories.length;
    const minIndex = Math.max(1, totalCount - 11);
    const maxIndex = totalCount;

    const elComp = document.querySelector("#comparisonChart");
    if (elComp && typeof ApexCharts !== "undefined") {
        const opts3 = {
            series: seriesComp,
            chart: {
                type: 'bar',
                height: 280,
                stacked: true,
                foreColor: '#94a3b8',
                toolbar: {
                    show: true,
                    tools: {
                        download: false,
                        selection: false,
                        zoom: true,
                        zoomin: true,
                        zoomout: true,
                        pan: true,
                        reset: true
                    }
                },
                zoom: {
                    enabled: true,
                    type: 'x',
                    autoScaleYaxis: true
                },
                background: 'transparent',
                fontFamily: 'Inter, sans-serif'
            },
            colors: barColors,
            plotOptions: { bar: { horizontal: false, columnWidth: '55%', borderRadius: 3 } },
            dataLabels: { enabled: false },
            xaxis: {
                type: 'category',
                tickPlacement: 'on',
                categories: allCategories,
                min: minIndex,
                max: maxIndex,
                axisBorder: { show: false },
                axisTicks: { show: false },
                labels: { rotate: -30, style: { fontSize: '10px' } }
            },
            yaxis: { labels: { style: { colors: '#94a3b8' }, formatter: (v) => fmt(v) } },
            grid: { borderColor: 'rgba(255,255,255,0.05)', padding: { left: 15, right: 15 } },
            legend: { position: 'bottom', labels: { colors: '#94a3b8' } },
            tooltip: { theme: 'dark', y: { formatter: (val) => fmtFull(val) } }
        };

        if (chartComparison) chartComparison.destroy();
        chartComparison = new ApexCharts(elComp, opts3);
        chartComparison.render().then(() => {
            setTimeout(() => {
                if (chartComparison) chartComparison.zoomX(minIndex, maxIndex);
            }, 100);
        });
    }
};

const renderPatrimonialChart = (targetPeriod) => {
    const cleanBalances = [...rawBalances].sort((a, b) => a.periodo.localeCompare(b.periodo));
    const allCategories = cleanBalances.map(b => b.periodo);
    const expensasData = allCategories.map(p => {
        const b = cleanBalances.find(x => x.periodo === p);
        return b ? (b.monto_expensa || 0) : 0;
    });

    const totalCount = allCategories.length;
    const minIndex = Math.max(1, totalCount - 11);
    const maxIndex = totalCount;

    const elPat = document.querySelector("#patrimonialChart");
    if (elPat && typeof ApexCharts !== "undefined") {
        const opts4 = {
            series: [{ name: 'Expensas Liquidadas ($)', data: expensasData }],
            chart: {
                type: 'line',
                height: 280,
                foreColor: '#94a3b8',
                toolbar: {
                    show: true,
                    tools: {
                        download: false,
                        selection: false,
                        zoom: true,
                        zoomin: true,
                        zoomout: true,
                        pan: true,
                        reset: true
                    }
                },
                zoom: {
                    enabled: true,
                    type: 'x',
                    autoScaleYaxis: true
                },
                background: 'transparent',
                fontFamily: 'Inter, sans-serif'
            },
            colors: ['#0ea5e9'],
            stroke: { curve: 'smooth', width: 3 },
            markers: { size: 4 },
            xaxis: {
                type: 'category',
                tickPlacement: 'on',
                categories: allCategories,
                min: minIndex,
                max: maxIndex,
                axisBorder: { show: false },
                axisTicks: { show: false },
                labels: { rotate: -30, style: { colors: '#94a3b8' } }
            },
            yaxis: { labels: { style: { colors: '#94a3b8' }, formatter: (v) => fmt(v) } },
            grid: { borderColor: 'rgba(255,255,255,0.05)' },
            tooltip: { theme: 'dark', y: { formatter: (val) => fmtFull(val) } }
        };

        if (chartPatrimonial) chartPatrimonial.destroy();
        chartPatrimonial = new ApexCharts(elPat, opts4);
        chartPatrimonial.render().then(() => {
            setTimeout(() => {
                if (chartPatrimonial) chartPatrimonial.zoomX(minIndex, maxIndex);
            }, 100);
        });
    }
};



// ── DRILLDOWN RUBRO CHARTS (REAL DATA ALVEAR 961/963) ───────────
const createDrillChart = (selectorId, rubroName, currentInstance, customFilter = null, targetPeriod = null) => {
    const el = document.querySelector(selectorId);
    if (!el || typeof ApexCharts === "undefined") return currentInstance;

    const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort();
    
    let matchingExpenses = rawExpenses;
    if (customFilter) {
        matchingExpenses = rawExpenses.filter(customFilter);
    } else {
        matchingExpenses = rawExpenses.filter(e => normalizeRubro(e.rubro) === rubroName);
    }

    // Fallback by keyword if no direct rubro match
    if (matchingExpenses.length === 0) {
        const key = rubroName.toLowerCase();
        matchingExpenses = rawExpenses.filter(e => 
            (e.rubro || "").toLowerCase().includes(key) || 
            (e.concepto || "").toLowerCase().includes(key)
        );
    }

    // Helper para categorizar conceptos y proveedores
    const getConceptGroup = (e) => {
        if (!e) return "Gastos Varios";
        const conc = ((e.concepto || "") + " " + (e.proveedor || "")).trim();
        const lower = conc.toLowerCase();

        if (lower.includes("edesur")) return "Edesur SA";
        if (lower.includes("aysa")) return "AySA";
        if (lower.includes("metrogas")) return "Metrogas";
        if (lower.includes("personal") || lower.includes("telecom") || lower.includes("iplan")) return "Personal / Telecom";
        if (lower.includes("ferazzoli") || lower.includes("adm-vf") || lower.includes("honorarios adm")) return "Adm. Verónica Ferazzoli";
        if (lower.includes("sueldo básico") || lower.includes("sueldo basico")) return "Sueldo Básico";
        if (lower.includes("antigüedad") || lower.includes("antiguedad")) return "Antigüedad";
        if (lower.includes("sac") || lower.includes("sueldo anual")) return "SAC Aguinaldo";
        if (lower.includes("afip") || lower.includes("f 931") || lower.includes("cargas sociales")) return "AFIP / Cargas Sociales";
        if (lower.includes("suterh") || lower.includes("fateryh") || lower.includes("seracarh") || lower.includes("sindicato")) return "SUTERH / FATERYH";
        if (lower.includes("octopus")) return "Plataforma Octopus";
        if (lower.includes("noplag")) return "Noplag Control Plagas";
        if (lower.includes("asegal")) return "Asegal SRL";
        if (lower.includes("geas")) return "Geas Mantenimiento";
        if (lower.includes("banco") || lower.includes("itaú") || lower.includes("macro") || lower.includes("comision")) return "Gastos Bancarios";
        if (lower.includes("seguro")) return "Seguros del Edificio";
        if (lower.includes("dalla valle")) return "Dalla Valle Porteros";
        if (lower.includes("cerrajeria") || lower.includes("hugo")) return "Cerrajería Hugo";
        if (lower.includes("ramos matias")) return "Ramos Matías";
        if (lower.includes("ocampos")) return "Ocampos Abel Ascensores";
        if (lower.includes("santoandre")) return "Santoandre Nicolás";
        if (lower.includes("centro-grafico") || lower.includes("centro grafico")) return "Centro Gráfico";
        if (lower.includes("gestionar")) return "Gestionar Expedientes";

        let raw = (e.proveedor && e.proveedor !== "S/D") ? e.proveedor : e.concepto;
        let vendorName = (raw || "").split("–")[0].split("-")[0].trim();
        vendorName = vendorName.replace(/^\d+[\s\.\-]+/, '').trim();
        return vendorName.slice(0, 25) || "Gastos Varios";
    };
    window.getConceptGroup = getConceptGroup;

    // Group matching expenses by concept group across all periods
    let groupTotals = {};
    matchingExpenses.forEach(e => {
        if (e.monto > 0) {
            const grp = getConceptGroup(e);
            groupTotals[grp] = (groupTotals[grp] || 0) + e.monto;
        }
    });

    const topGroups = Object.keys(groupTotals)
        .sort((a, b) => groupTotals[b] - groupTotals[a])
        .slice(0, 5);

    let series = topGroups.map(grp => ({
        name: grp,
        data: allPeriods.map(p =>
            Math.round(matchingExpenses.filter(e => e.periodo === p && getConceptGroup(e) === grp)
                .reduce((a, e) => a + e.monto, 0))
        )
    })).filter(s => s.data.some(v => v > 0));

    // If still empty series, calculate total for rubro per period
    if (series.length === 0) {
        const totalData = allPeriods.map(p => {
            const sum = matchingExpenses.filter(e => e.periodo === p).reduce((a, e) => a + e.monto, 0);
            return Math.round(sum);
        });
        series = [{ name: rubroName, data: totalData }];
    }

    const totalPeriods = allPeriods.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series: series,
        chart: {
            type: 'bar',
            height: 220,
            stacked: true,
            foreColor: '#94a3b8',
            toolbar: {
                show: true,
                tools: { download: false, selection: false, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true }
            },
            zoom: {
                enabled: true,
                type: 'x',
                autoScaleYaxis: true
            },
            background: 'transparent',
            fontFamily: 'Inter, sans-serif'
        },
        colors: ['#06b6d4', '#f472b6', '#fbbf24', '#a78bfa', '#34d399', '#60a5fa'],
        plotOptions: { bar: { horizontal: false, columnWidth: '65%', borderRadius: 2 } },
        dataLabels: { enabled: false },
        xaxis: {
            type: 'category',
            tickPlacement: 'on',
            categories: allPeriods,
            min: minIndex,
            max: maxIndex,
            axisBorder: { show: false },
            axisTicks: { show: false },
            labels: { rotate: -40, style: { colors: '#94a3b8', fontSize: '9px' } }
        },
        yaxis: { labels: { style: { colors: '#94a3b8' }, formatter: v => fmt(v) } },
        grid: { borderColor: 'rgba(255,255,255,0.03)', padding: { left: 15, right: 15 } },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '10px' },
        fill: { opacity: 0.95 },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (currentInstance && typeof currentInstance.destroy === "function") {
        try { currentInstance.destroy(); } catch(e) {}
    }
    const chart = new ApexCharts(el, opts);
    chart.render().then(() => {
        setTimeout(() => {
            if (chart) chart.zoomX(minIndex, maxIndex);
        }, 100);
    });
    return chart;
};

const renderDrilldownCharts = (targetPeriod) => {
    chartDrillSueldos = createDrillChart("#drillSueldosChart", "Sueldos y Aportes", chartDrillSueldos,
        e => normalizeRubro(e.rubro) === "Sueldos y Aportes",
        targetPeriod
    );

    chartDrillServicios = createDrillChart("#drillServiciosChart", "Servicios Públicos", chartDrillServicios,
        e => normalizeRubro(e.rubro) === "Servicios Públicos",
        targetPeriod
    );

    chartDrillContratos = createDrillChart("#drillContratosChart", "Abonos de Servicios", chartDrillContratos,
        e => normalizeRubro(e.rubro) === "Abonos de Servicios",
        targetPeriod
    );

    chartDrillManto = createDrillChart("#drillMantoChart", "Mantenimiento de Partes Comunes", chartDrillManto,
        e => normalizeRubro(e.rubro) === "Mantenimiento de Partes Comunes",
        targetPeriod
    );

    chartDrillReparaciones = createDrillChart("#drillReparacionesChart", "Trabajos de Reparación en Unidades Funcionales", chartDrillReparaciones,
        e => normalizeRubro(e.rubro) === "Trabajos de Reparación en Unidades Funcionales",
        targetPeriod
    );

    chartDrillBanco = createDrillChart("#drillBancoChart", "Gastos Bancarios", chartDrillBanco, 
        e => normalizeRubro(e.rubro) === "Gastos Bancarios",
        targetPeriod
    );

    chartDrillLimpieza = createDrillChart("#drillLimpiezaChart", "Gastos de Limpieza", chartDrillLimpieza,
        e => normalizeRubro(e.rubro) === "Gastos de Limpieza",
        targetPeriod
    );

    chartDrillAdmin = createDrillChart("#drillAdminChart", "Gastos de Administración", chartDrillAdmin,
        e => normalizeRubro(e.rubro) === "Gastos de Administración",
        targetPeriod
    );

    chartDrillSeguros = createDrillChart("#drillSegurosChart", "Pagos del Período por Seguros", chartDrillSeguros,
        e => normalizeRubro(e.rubro) === "Pagos del Período por Seguros",
        targetPeriod
    );

    chartDrillVarios = createDrillChart("#drillVariosChart", "Otros", chartDrillVarios,
        e => normalizeRubro(e.rubro) === "Otros",
        targetPeriod
    );

    window.chartDrillSueldos = chartDrillSueldos;
    window.chartDrillServicios = chartDrillServicios;
    window.chartDrillContratos = chartDrillContratos;
    window.chartDrillManto = chartDrillManto;
    window.chartDrillReparaciones = chartDrillReparaciones;
    window.chartDrillBanco = chartDrillBanco;
    window.chartDrillLimpieza = chartDrillLimpieza;
    window.chartDrillAdmin = chartDrillAdmin;
    window.chartDrillSeguros = chartDrillSeguros;
    window.chartDrillVarios = chartDrillVarios;
};
window.renderDrilldownCharts = renderDrilldownCharts;

// ── EMPLOYEE / SALARY SECTION (DISCRIMINADO: SUELDO BASE, SAC, HORAS EXTRAS, CARGAS SOCIALES) ──
const renderEmployeeKPIs = (period) => {
    const subtitleEl = document.getElementById('empSubtitle');
    if (subtitleEl) {
        subtitleEl.innerHTML = period === 'todos'
            ? `Montos acumulados de <strong>todos los períodos</strong> (Encargado Titular c/Vivienda).`
            : `Montos del período seleccionado <strong>(${period})</strong> (Encargado Titular c/Vivienda).`;
    }

    const sumCategory = (keywords) => {
        const src = period === 'todos'
            ? rawExpenses.filter(e => keywords.some(k => (e.concepto || "").toLowerCase().includes(k)))
            : rawExpenses.filter(e => e.periodo === period && keywords.some(k => (e.concepto || "").toLowerCase().includes(k)));
        return src.reduce((a, e) => a + e.monto, 0);
    };

    // 1. Sueldo Base Encargado (Básico + Antigüedad + Viáticos + Residuos)
    const sueldoBase = sumCategory(['sueldo básico', 'sueldo basico', 'antigüedad', 'antiguedad', 'retiro de residuos', 'clasificación de residuos', 'clasificacion de residuos', 'viáticos', 'viaticos']);
    
    // 2. SAC (Aguinaldo 1º y 2º Semestre)
    const sacMonto = sumCategory(['sac – sueldo anual', 'sac - sueldo anual', 'sueldo anual complementario']);

    // 3. Horas Extras & Adicionales (50%, 100%, Bonos, Suplencias)
    const horasExtrasMonto = sumCategory(['horas extra', 'horas extras', '50%', '100%', 'bono remunerativo', 'suplente', 'reemplazo']);

    // 4. Cargas Sociales (AFIP, SUTERH, FATERYH, Jubilación, PAMI, Sindicatos)
    const cargasSocialesMonto = sumCategory(['afip f 931', 'jubilación', 'jubilacion', 'pami', 'inssjp', 'suterh', 'fateryh', 'seracarh', 'caja protección', 'caja proteccion', 'cuota sindical']);

    const sueldoBaseHist = rawExpenses.filter(e => ['sueldo básico', 'sueldo basico', 'antigüedad', 'antiguedad', 'viáticos', 'viaticos', 'residuos'].some(k => (e.concepto || "").toLowerCase().includes(k))).reduce((a, e) => a + e.monto, 0);
    const sacHist = rawExpenses.filter(e => ['sac', 'sueldo anual'].some(k => (e.concepto || "").toLowerCase().includes(k))).reduce((a, e) => a + e.monto, 0);

    const el1 = document.getElementById('empIbrahimMonto');
    const el2 = document.getElementById('empLourdesMonto');
    const el3 = document.getElementById('empYamilRepMonto');
    const el4 = document.getElementById('empCargasMonto');
    const elH1 = document.getElementById('empIbrahimHist');
    const elH2 = document.getElementById('empLourdesHist');

    if (el1) el1.textContent = sueldoBase > 0 ? fmt(sueldoBase) : '—';
    if (el2) el2.textContent = sacMonto > 0 ? fmt(sacMonto) : '—';
    if (el3) el3.textContent = horasExtrasMonto > 0 ? fmt(horasExtrasMonto) : '—';
    if (el4) el4.textContent = cargasSocialesMonto > 0 ? fmt(cargasSocialesMonto) : '—';
    if (elH1) elH1.textContent = 'Acum. histórico base: ' + fmt(sueldoBaseHist);
    if (elH2) elH2.textContent = 'Acum. histórico SAC: ' + fmt(sacHist);
};

const renderEmployeeChart = (targetPeriod) => {
    const el = document.querySelector('#employeeChart');
    if (!el || typeof ApexCharts === "undefined") return;

    const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort();

    const sumPattern = (keywords) => allPeriods.map(p =>
        Math.round(rawExpenses.filter(e => e.periodo === p && keywords.some(k => (e.concepto || "").toLowerCase().includes(k)))
            .reduce((a, e) => a + e.monto, 0))
    );

    const series = [
        { name: 'Sueldo Base (Básico + Antigüedad + Viáticos)', data: sumPattern(['sueldo básico', 'sueldo basico', 'antigüedad', 'antiguedad', 'retiro de residuos', 'clasificación de residuos', 'viáticos']) },
        { name: 'SAC (Aguinaldo)', data: sumPattern(['sac', 'sueldo anual']) },
        { name: 'Horas Extras (50% / 100%) & Bonos', data: sumPattern(['horas extra', 'horas extras', '50%', '100%', 'bono remunerativo', 'suplente', 'reemplazo']) },
        { name: 'Cargas Sociales (AFIP / SUTERH / FATERYH)', data: sumPattern(['afip', 'jubilación', 'jubilacion', 'pami', 'inssjp', 'suterh', 'fateryh', 'seracarh', 'caja protección', 'cuota sindical']) }
    ];

    const totalPeriods = allPeriods.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series,
        chart: {
            type: 'bar',
            height: 280,
            stacked: true,
            foreColor: '#94a3b8',
            toolbar: {
                show: true,
                tools: { download: false, selection: false, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true }
            },
            zoom: {
                enabled: true,
                type: 'x',
                autoScaleYaxis: true
            },
            background: 'transparent',
            fontFamily: 'Inter, sans-serif'
        },
        colors: ['#06b6d4', '#f472b6', '#a78bfa', '#fbbf24'],
        plotOptions: { bar: { horizontal: false, columnWidth: '60%', borderRadius: 3 } },
        dataLabels: { enabled: false },
        xaxis: {
            type: 'category',
            tickPlacement: 'on',
            categories: allPeriods,
            min: minIndex,
            max: maxIndex,
            axisBorder: { show: false },
            axisTicks: { show: false },
            labels: { rotate: -30, style: { fontSize: '10px' } }
        },
        yaxis: { labels: { style: { colors: '#94a3b8' }, formatter: v => fmt(v) } },
        grid: { borderColor: 'rgba(255,255,255,0.05)', padding: { left: 15, right: 15 } },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' } },
        fill: { opacity: 0.9 },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartEmployee) chartEmployee.destroy();
    chartEmployee = new ApexCharts(el, opts);
    chartEmployee.render().then(() => {
        setTimeout(() => {
            if (chartEmployee) chartEmployee.zoomX(minIndex, maxIndex);
        }, 100);
    });
};

// ── PROVIDER AUDIT TABLE VS IPC (REAL ALVEAR 961/963 PROVIDERS) ─
const auditProviders = (period) => {
    const tbody = document.getElementById("providerAuditBody");
    if (!tbody) return;

    if (period === "todos") {
        const latest = rawBalances[0]?.periodo || '2026-06';
        period = latest;
    }

    const [y, m] = period.split("-").map(Number);
    const prevYearPeriod = `${y - 1}-${String(m).padStart(2, '0')}`;

    const targetProviders = [
        { name: "💼 Adm. Verónica Ferazzoli", key: "ferazzoli", rubro: "Gastos de Administración" },
        { name: "📱 Octopus (Plataforma Expensas)", key: "octopus", rubro: "Abonos de Servicios" },
        { name: "⚡ Edesur SA (Servicio Eléctrico)", key: "edesur", rubro: "Servicios Públicos" },
        { name: "🌐 Personal / Telecom (Internet)", key: "personal", rubro: "Abonos de Servicios" },
        { name: "🌐 Iplan (Internet Consorcio)", key: "iplan", rubro: "Abonos de Servicios" },
        { name: "🐜 Noplag (Desinsectación)", key: "noplag", rubro: "Abonos de Servicios" },
        { name: "🛗 Asegal SRL (Ascensores)", key: "asegal", rubro: "Abonos de Servicios" },
        { name: "🔥 Geas (Matafuegos)", key: "geas", rubro: "Abonos de Servicios" }
    ];

    let rowsHtml = "";
    const ipcActual = ipcData[period]?.valor;
    const ipcPrev = ipcData[prevYearPeriod]?.valor;
    const ipcAcum = (ipcActual && ipcPrev) ? ((ipcActual - ipcPrev) / ipcPrev) * 100 : null;
    const ipcText = ipcAcum !== null ? `${ipcAcum.toFixed(1)}%` : "N/D";

    targetProviders.forEach(p => {
        const actualExpense = rawExpenses.find(e => e.periodo === period && (e.concepto || "").toLowerCase().includes(p.key));
        const prevExpense = rawExpenses.find(e => e.periodo === prevYearPeriod && (e.concepto || "").toLowerCase().includes(p.key));

        if (actualExpense) {
            const prevMonto = prevExpense ? prevExpense.monto : 0;
            const varPct = prevMonto > 0 ? ((actualExpense.monto - prevMonto) / prevMonto) * 100 : 0;
            
            let badge = `<span class="badge badge-success">🟢 Estable</span>`;
            if (ipcAcum !== null && prevMonto > 0) {
                if (varPct > ipcAcum + 25) {
                    badge = `<span class="badge badge-danger">🔴 Excesivo (> IPC + 25%)</span>`;
                } else if (varPct > ipcAcum + 5) {
                    badge = `<span class="badge badge-warning">🟡 Alto (> IPC)</span>`;
                }
            }

            const expected = prevMonto > 0 ? prevMonto * (1 + ((ipcAcum || 0) / 100)) : actualExpense.monto;
            const diffValue = actualExpense.monto - expected;
            const diffFmt = fmtFull(Math.abs(diffValue));
            let diffHtml = `<td style="text-align:right; color:var(--text-3); font-size:0.85rem;">$ 0,00</td>`;
            if (diffValue > 50) {
                diffHtml = `<td style="text-align:right; color:#f43f5e; font-weight:700;">+${diffFmt}</td>`;
            } else if (diffValue < -50) {
                diffHtml = `<td style="text-align:right; color:#10b981; font-weight:700;">-${diffFmt}</td>`;
            }

            rowsHtml += `
                <tr>
                    <td style="font-weight:600; color:var(--text-2);">${p.name}</td>
                    <td style="color:var(--text-3); font-size:0.8rem;">${p.rubro}</td>
                    <td style="text-align:right; font-weight:700; color:var(--text-1);">${fmtFull(actualExpense.monto)}</td>
                    <td style="text-align:right; color:var(--text-3);">${prevMonto > 0 ? fmtFull(prevMonto) : 'S/D'}</td>
                    <td style="text-align:right; font-weight:700; color:${ipcAcum !== null && varPct > ipcAcum ? '#f43f5e' : '#10b981'};">${prevMonto > 0 ? varPct.toFixed(1) + '%' : '—'}</td>
                    <td style="text-align:right; color:var(--text-2); font-weight:500;">${ipcText}</td>
                    ${diffHtml}
                    <td style="text-align:center;">${badge}</td>
                </tr>
            `;
        }
    });

    if (rowsHtml === "") {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:1.5rem;">Auditando comprobantes respaldatorios para el período ${period}...</td></tr>`;
    } else {
        tbody.innerHTML = rowsHtml;
    }
};

// ── CONTROL DE FACTURAS EN SIDEBAR ──────────────────────────────
const renderMissingInvoices = () => {
    const container = document.getElementById("missingInvoicesAlerts");
    if (!container) return;

    const recentPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort().reverse().slice(0, 6);
    const recurringVendors = [
        { name: "Adm. Verónica Ferazzoli", key: "ferazzoli" },
        { name: "Octopus Expensas", key: "octopus" },
        { name: "Edesur SA (Luz)", key: "edesur" },
        { name: "Internet (Personal/Iplan)", key: "personal", altKey: "iplan" },
        { name: "Noplag Fumigación", key: "noplag" }
    ];

    let missingCount = 0;
    let html = "";

    recurringVendors.forEach(v => {
        const missingPeriods = recentPeriods.filter(p =>
            !rawExpenses.some(e => {
                const conc = (e.concepto || "").toLowerCase();
                return e.periodo === p && (conc.includes(v.key) || (v.altKey && conc.includes(v.altKey)));
            })
        );
        if (missingPeriods.length > 0) {
            missingCount += missingPeriods.length;
            html += `
                <div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); border-radius:6px; padding:0.4rem 0.6rem; font-size:0.72rem;">
                    <div style="font-weight:700; color:#fbbf24;">⚠️ ${v.name}</div>
                    <div style="color:var(--text-3); font-size:0.68rem; margin-top:2px;">Sin comprobante en: ${missingPeriods.join(", ")}</div>
                </div>
            `;
        }
    });

    if (missingCount === 0) {
        container.innerHTML = `
            <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:6px; padding:0.4rem 0.6rem; font-size:0.72rem; color:#34d399;">
                ✓ Todos los comprobantes del último semestre al día.
            </div>
        `;
    } else {
        container.innerHTML = html;
    }
};

// ── SERVICES MONITOR IN SIDEBAR ─────────────────────────────────
const loadServicesStatus = () => {
    const container = document.getElementById("servicesStatusWidget");
    if (!container) return;

    fetch(getAssetUrl("servicios_status.json"))
        .then(r => r.json())
        .then(data => {
            const edesur = data.edesur || data.luz || { status: "Normal", message: "Sin alertas" };
            const aysa = data.aysa || data.agua || { status: "Normal", message: "Sin alertas" };
            const metrogas = data.metrogas || data.gas || { status: "Normal", message: "Sin alertas" };

            const getBadge = (srv) => {
                if (srv.status === "Alerta") {
                    return `<span class="badge badge-warning" style="white-space: nowrap;">⚠️ Alerta</span>`;
                }
                return `<span class="badge badge-success" style="white-space: nowrap;">🟢 Normal</span>`;
            };

            const getMessageHtml = (srv) => {
                if (srv.status === "Alerta" && srv.message) {
                    return `<div style="font-size: 0.65rem; color: var(--text-3); margin-top: 1px; margin-bottom: 0.4rem; padding-left: 12px; border-left: 1.5px dashed rgba(251,191,36,0.4); line-height: 1.25;">${srv.message}</div>`;
                }
                return '';
            };

            container.innerHTML = `
                <div style="margin-bottom: 0.35rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                        <span style="color: var(--text-2);">⚡ Luz (Edesur)</span>
                        ${getBadge(edesur)}
                    </div>
                    ${getMessageHtml(edesur)}
                </div>

                <div style="margin-bottom: 0.35rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                        <span style="color: var(--text-2);">💧 Agua (AySA)</span>
                        ${getBadge(aysa)}
                    </div>
                    ${getMessageHtml(aysa)}
                </div>

                <div style="margin-bottom: 0.35rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                        <span style="color: var(--text-2);">🔥 Gas (Metrogas)</span>
                        ${getBadge(metrogas)}
                    </div>
                    ${getMessageHtml(metrogas)}
                </div>

                <div style="font-size: 0.6rem; color: var(--text-3); text-align: right; margin-top: 6px; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 4px;">Act: ${data.actualizado || '06/2026'}</div>
            `;
        })
        .catch(err => {
            console.warn("No se pudo cargar el estado de servicios:", err);
            container.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-3);">Estado no disponible</span>`;
        });
};

// ── FINES SECTION ───────────────────────────────────────────────
const renderFines = (period) => {
    const tbody = document.getElementById("finesTableBody");
    const subtitleEl = document.getElementById("finesSubtitle");
    if (!tbody) return;

    const items = rawProrrateo.filter(item => {
        const okPeriod = (period === "todos" || item.periodo === period);
        const amt = item.gastos_extra || 0;
        const okAmount = amt >= 1.0 && amt < 500000;
        return okPeriod && okAmount;
    });

    if (subtitleEl) {
        subtitleEl.innerText = period === "todos"
            ? "Imputaciones individuales y gastos particulares en todos los períodos auditados"
            : `Gastos Particulares / Imputaciones registradas en la col. GAST. PART. (Pág. 6) del período ${period}`;
    }

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--text-3);padding:1.5rem;">No hay gastos particulares ni imputaciones individuales registradas en este período.</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(m => {
        const ubi = (m.piso && m.piso !== m.dpto) ? `Piso ${m.piso}, Dpto ${m.dpto}` : `Dpto ${m.dpto}`;
        return `
        <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:0.75rem 0.5rem; font-weight:700; color:var(--accent);">UF ${String(m.uf).padStart(3, '0')} (${ubi})</td>
            <td style="padding:0.75rem 0.5rem; color:var(--text-1);">Gasto Particular / Imputación Individual (Prorrateo Pág. 6)</td>
            <td style="padding:0.75rem 0.5rem; text-align:right; font-weight:700; color:var(--red);">${fmtFull(m.gastos_extra)}</td>
        </tr>`;
    }).join("");
};

// ── TABLE RENDERER WITH CLIENT-SIDE PAGINATION ──────────────────
const renderTable = () => {
    const tbody = document.getElementById("expensesTableBody");
    const info = document.getElementById("tableInfo");
    const paginationInfo = document.getElementById("paginationInfo");
    const paginationBtns = document.getElementById("paginationBtns");

    if (!tbody) return;

    const total = filteredExpenses.length;
    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-3); padding:2rem;">No se encontraron registros coincidentes.</td></tr>`;
        if (info) info.textContent = "Mostrando 0 de 0 registros";
        if (paginationInfo) paginationInfo.textContent = "";
        if (paginationBtns) paginationBtns.innerHTML = "";
        return;
    }

    const ps = pageSize >= 9999 ? total : pageSize;
    const totalPages = Math.ceil(total / ps) || 1;
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * ps;
    const end = Math.min(start + ps, total);
    const pageItems = filteredExpenses.slice(start, end);

    if (info) info.textContent = `Mostrando ${start + 1} - ${end} de ${total} registros`;
    if (paginationInfo) paginationInfo.textContent = `Página ${currentPage} de ${totalPages}`;

    let btnsHtml = "";
    if (currentPage > 1) btnsHtml += `<button type="button" class="pg-btn" onclick="changePage(${currentPage - 1})">‹</button>`;
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || (p >= currentPage - 2 && p <= currentPage + 2)) {
            btnsHtml += `<button type="button" class="pg-btn ${p === currentPage ? 'active' : ''}" onclick="changePage(${p})">${p}</button>`;
        } else if (p === currentPage - 3 || p === currentPage + 3) {
            btnsHtml += `<span style="color:var(--text-3); padding:0 4px;">...</span>`;
        }
    }
    if (currentPage < totalPages) btnsHtml += `<button type="button" class="pg-btn" onclick="changePage(${currentPage + 1})">›</button>`;
    if (paginationBtns) paginationBtns.innerHTML = btnsHtml;

    tbody.innerHTML = pageItems.map(g => {
        const estadoBadge = g.estado === "Pendiente"
            ? `<span class="badge badge-pendiente">Pendiente</span>`
            : `<span class="badge badge-pagado">Pagado</span>`;

        const tipoBadge = g.tipo === "Fijo"
            ? `<span class="badge badge-fijo">Fijo</span>`
            : `<span class="badge badge-variable">Variable</span>`;

        const lowerConcepto = (g.concepto || "").toLowerCase();
        const isLabor = isLaborItem(lowerConcepto);
        const m = parseInt(g.periodo.slice(5, 7), 10);
        const isSacMonth = (m === 6 || m === 7 || m === 12 || m === 1);
        const isSacEffect = isLabor && isSacMonth && (g.desviacion_pct || 0) > 15;

        let varText = '—';
        let varColor = 'var(--text-3)';

        if (g.monto_anterior && g.desviacion_pct !== 0) {
            const sign = g.desviacion_pct > 0 ? '+' : '';
            const sacTag = isSacEffect ? ' (Inc. SAC)' : '';
            varText = `${sign}${g.desviacion_pct}%${sacTag}`;

            if (isSacEffect) {
                varColor = '#a855f7';
            } else if (g.desviacion_pct > 0) {
                varColor = '#f87171';
            } else {
                varColor = '#34d399';
            }
        }

        let alertaHtml = `<span class="badge-normal">Normal</span>`;
        if (g.anomalia) {
            alertaHtml = `<span class="badge badge-anomalia">+${g.desviacion_pct}% Desvío</span>`;
        }

        const safeConcepto = (g.concepto || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");

        return `
            <tr>
                <td style="font-weight:600; color:var(--accent);">${g.periodo}</td>
                <td>${getCatPill(g.rubro)}</td>
                <td>${tipoBadge}</td>
                <td>${alertaHtml}</td>
                <td>${estadoBadge}</td>
                <td>
                    <span class="concepto-text" onclick="openVendorModal('${safeConcepto}')" title="Clic para ver historial del proveedor">
                        ${g.concepto}
                    </span>
                </td>
                <td style="text-align:right; color:var(--text-3);">${g.monto_anterior ? fmtFull(g.monto_anterior) : '—'}</td>
                <td style="text-align:right; color:${varColor}; font-weight:600;">
                    ${varText}
                </td>
                <td style="text-align:right; font-weight:700; color:var(--text-1); font-family:'Outfit', sans-serif;">
                    ${fmtFull(g.monto)}
                </td>
            </tr>
        `;
    }).join("");
};

function changePage(p) {
    currentPage = p;
    renderTable();
}

// ── VENDOR DRILLDOWN MODAL ──────────────────────────────────────
const openVendorModal = (vendorName) => {
    const modal = document.getElementById("providerModal");
    if (!modal) return;

    document.getElementById("providerModalName").innerText = vendorName;

    const vendorKey = (vendorName || "").toLowerCase().slice(0, 25);
    const vendorItems = rawExpenses.filter(e => (e.concepto || "").toLowerCase().includes(vendorKey) || (e.rubro || "").toLowerCase().includes(vendorKey));

    const totalMonto = vendorItems.reduce((s, e) => s + e.monto, 0);
    const count = vendorItems.length;
    const avg = count > 0 ? totalMonto / count : 0;
    const grandTotal = rawExpenses.reduce((s, e) => s + e.monto, 0);
    const pctShare = grandTotal > 0 ? ((totalMonto / grandTotal) * 100).toFixed(1) : "0.0";

    document.getElementById("providerTotal").innerText = fmtFull(totalMonto);
    document.getElementById("providerPct").innerText = `${pctShare}%`;
    document.getElementById("providerCount").innerText = count;
    document.getElementById("providerAvg").innerText = fmtFull(avg);

    const historyList = document.getElementById("providerHistoryList");
    if (vendorItems.length === 0) {
        historyList.innerHTML = `<div style="color:var(--text-3); padding:1rem; text-align:center;">No hay comprobantes específicos registrados para ${vendorName}.</div>`;
    } else {
        historyList.innerHTML = vendorItems.slice(0, 30).map(item => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0.8rem; border-bottom:1px solid var(--border);">
                <div>
                    <strong>[${item.periodo}] ${item.concepto}</strong>
                    <div style="font-size:0.75rem; color:var(--text-3);">${item.rubro}</div>
                </div>
                <div style="text-align:right; font-weight:700; color:var(--accent);">
                    ${fmtFull(item.monto)}
                </div>
            </div>
        `).join("");
    }

    modal.classList.add("open");
};

const closeModal = () => {
    const modal = document.getElementById("providerModal");
    if (modal) modal.classList.remove("open");
};

// ── EXPORT CSV & PDF ───────────────────────────────────────────
const exportCSV = () => {
    if (!filteredExpenses.length) return alert("No hay datos para exportar.");
    const headers = ["Periodo", "Rubro", "Concepto", "Tipo", "Monto"];
    const rows = filteredExpenses.map(e => [e.periodo, e.rubro, `"${e.concepto}"`, e.tipo, e.monto]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `auditoria_alvear963_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const exportPDF = () => {
    window.print();
};
