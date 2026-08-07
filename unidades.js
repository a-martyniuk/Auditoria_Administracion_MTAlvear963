// Dashboard de Unidades Funcionales (U.F.) — Alvear 961/963
// Portado desde Sarmiento 151 — misma arquitectura
// ─────────────────────────────────────────────────────────────

let rawProrrateo = [];
let filteredProrrateo = [];

// Chart instances
let chartMorosity = null;
let chartCaja = null;
let chartUfHistory = null;

// Pagination (hidden but referenced in Sarmiento logic)
let currentPage = 1;

// Formatters
const fmt = (n) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(n || 0);

const fmtFull = (n) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(n || 0);

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
    fetch(getAssetUrl("prorrateo.json"))
        .then(r => r.json())
        .then(data => {
            const allProrrateo = [];
            if (Array.isArray(data)) {
                data.forEach(item => allProrrateo.push(item));
            } else if (data.prorrateo && Array.isArray(data.prorrateo)) {
                data.prorrateo.forEach(item => allProrrateo.push(item));
            } else if (data && typeof data === 'object') {
                Object.keys(data).forEach(p => {
                    if (Array.isArray(data[p])) {
                        data[p].forEach(item => {
                            allProrrateo.push({ ...item, periodo: p });
                        });
                    }
                });
            }

            if (allProrrateo.length > 0) {
                rawProrrateo = allProrrateo;
                rawProrrateo.sort((a, b) => a.periodo.localeCompare(b.periodo));
            } else {
                rawProrrateo = [];
            }

            populatePeriodFilter();
            setupEventListeners();
            applyFilter();
            loadServicesStatus();
        })
        .catch(err => {
            console.error("Error loading prorrateo.json:", err);
            const tbody = document.getElementById("prorrateoTableBody");
            if (tbody) tbody.innerHTML =
                `<tr><td colspan="8" style="text-align:center;color:#f87171;padding:2rem;">
                    Error al cargar los datos de prorrateo.
                </td></tr>`;
        });
});

// ── Period filter ───────────────────────────────────────────────
const populatePeriodFilter = () => {
    const sel = document.getElementById("periodFilter");
    const periods = [...new Set(rawProrrateo.map(e => e.periodo))].sort().reverse();

    periods.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p; opt.textContent = p;
        sel.appendChild(opt);
    });

    if (periods.length > 0) {
        sel.value = periods[0];
    }

    const sidebarBadge = document.getElementById("sidebarPeriods");
    if (sidebarBadge && periods.length > 0) {
        sidebarBadge.textContent = `${periods.length} meses (${periods[periods.length - 1]} a ${periods[0]})`;
    }
};

// ── Event listeners ─────────────────────────────────────────────
const setupEventListeners = () => {
    const periodSel = document.getElementById("periodFilter");
    const searchInp = document.getElementById("searchInput");

    periodSel.addEventListener("change", applyFilter);
    searchInp.addEventListener("input", applyFilter);

    // Close modal on overlay click
    document.getElementById("ufModal").addEventListener("click", (e) => {
        if (e.target === document.getElementById("ufModal")) closeModal();
    });
};

// ── Apply filters ───────────────────────────────────────────────
const applyFilter = () => {
    const period = document.getElementById("periodFilter").value;
    const search = document.getElementById("searchInput").value.toLowerCase().trim();

    filteredProrrateo = rawProrrateo.filter(item => {
        const okPeriod = item.periodo === period;
        const okSearch = !search ||
            (item.propietario || '').toLowerCase().includes(search) ||
            (item.piso || '').toLowerCase().includes(search) ||
            (item.dpto || '').toLowerCase().includes(search) ||
            String(item.uf).includes(search);
        return okPeriod && okSearch;
    });

    currentPage = 1;
    updateDashboard(period);
};

// ── Master update ───────────────────────────────────────────────
const updateDashboard = (period) => {
    renderKPIs(period);
    auditCoeficients(period);
    renderMorosityChart(period);
    renderCajaChart(period);
    renderTable();
};

// ── COEFICIENTS AUDITOR ──────────────────────────────────────────
const auditCoeficients = (period) => {
    const alertsDiv = document.getElementById("coeficientAlerts");
    if (!alertsDiv) return;

    const periodData = rawProrrateo.filter(item => item.periodo === period);
    if (periodData.length === 0) {
        alertsDiv.style.display = "none";
        return;
    }

    const sumGA = periodData.reduce((sum, item) => sum + (item.ga_pct || 0), 0);
    const diffGA = Math.abs(sumGA - 100);

    let messages = [];
    let alertClass = "success-alert";
    let icon = "✅";

    if (diffGA > 0.5) {
        alertClass = "error-alert";
        icon = "🚨";
        messages.push(`<strong>Error de Prorrateo:</strong> La suma de los coeficientes de copropiedad no cierra al 100%. (Suma GA: ${sumGA.toFixed(3)}%). Esto indica una mala distribución en las expensas.`);
    } else {
        messages.push(`<strong>Auditoría de Coeficientes:</strong> La suma de los coeficientes de copropiedad del edificio cierra correctamente (GA: ${sumGA.toFixed(2)}%).`);
    }

    const ufDeviations = [];
    periodData.forEach(item => {
        const ufHistory = rawProrrateo.filter(h => h.uf === item.uf);
        const gaValues = ufHistory.map(h => h.ga_pct || 0);

        const getMode = (arr) => {
            const counts = {};
            let maxCount = 0;
            let mode = arr[0];
            arr.forEach(val => {
                const rounded = Math.round(val * 10000) / 10000;
                counts[rounded] = (counts[rounded] || 0) + 1;
                if (counts[rounded] > maxCount) { maxCount = counts[rounded]; mode = rounded; }
            });
            return mode;
        };

        const modalGA = getMode(gaValues);
        if (Math.abs(item.ga_pct - modalGA) > 0.001) {
            ufDeviations.push(`Depto ${item.dpto} (UF ${item.uf}) varió su coeficiente (GA: ${item.ga_pct}% vs. modal: ${modalGA}%)`);
        }
    });

    if (ufDeviations.length > 0) {
        if (alertClass !== "error-alert") {
            alertClass = "warning-alert";
            icon = "⚠️";
        }
        messages.push(`<strong>Alteraciones de Alícuota Detectadas:</strong><br><ul style="margin: 0.5rem 0 0 1.2rem; padding: 0;">${ufDeviations.map(d => `<li>${d}</li>`).join("")}</ul>`);
    }

    alertsDiv.className = `coef-alert ${alertClass}`;
    alertsDiv.innerHTML = `<span style="font-size: 1.2rem;">${icon}</span><div>${messages.join("<br><br>")}</div>`;
    alertsDiv.style.display = "flex";
};

// ── KPIs RENDERER ────────────────────────────────────────────────
const renderKPIs = (period) => {
    const periodData = rawProrrateo.filter(item => item.periodo === period);

    const totalFacturado = periodData.reduce((sum, item) => sum + (item.total || 0), 0);
    const totalRecaudado = periodData.reduce((sum, item) => sum + (item.pagos || 0), 0);
    const totalDeuda = periodData.reduce((sum, item) => sum + (item.deuda || 0), 0);
    const totalInteres = periodData.reduce((sum, item) => sum + (item.interes || 0), 0);

    const recPct = totalFacturado > 0 ? (totalRecaudado / totalFacturado) * 100 : 0;

    document.getElementById("kpiFacturado").textContent = fmt(totalFacturado);
    document.getElementById("kpiRecaudado").textContent = fmt(totalRecaudado);
    document.getElementById("kpiRecaudadoPct").textContent = `${recPct.toFixed(1)}% cobrado en término`;
    document.getElementById("kpiDeuda").textContent = fmt(totalDeuda);
    document.getElementById("kpiInteres").textContent = fmt(totalInteres);
};

// ── BAR CHART: TOP MOROSITY ──────────────────────────────────────
const renderMorosityChart = (period) => {
    const periodData = rawProrrateo.filter(item => item.periodo === period);

    const debtors = periodData
        .filter(item => (item.deuda || 0) > 0)
        .sort((a, b) => b.deuda - a.deuda)
        .slice(0, 7);

    const seriesData = debtors.map(item => Math.round(item.deuda));
    const categories = debtors.map(item => `UF ${String(item.uf).padStart(3, '0')} (${item.dpto})`);

    if (debtors.length === 0) {
        document.getElementById("morosityChart").innerHTML =
            `<div style="text-align:center; color:var(--green); padding:2rem; font-size:0.9rem;">✅ Sin deudores en este período</div>`;
        return;
    }

    const opts = {
        series: [{ name: 'Deuda Acumulada', data: seriesData }],
        chart: { type: 'bar', height: 230, foreColor: '#94a3b8', toolbar: { show: false }, background: 'transparent', fontFamily: 'Inter, sans-serif' },
        plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '60%' } },
        colors: ['#f43f5e'],
        dataLabels: { enabled: false },
        xaxis: {
            categories: categories,
            labels: { formatter: v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}` }
        },
        grid: { borderColor: 'rgba(255,255,255,0.05)' },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartMorosity) chartMorosity.destroy();
    chartMorosity = new ApexCharts(document.querySelector("#morosityChart"), opts);
    chartMorosity.render();
};

// ── DONUT CHART: CAJA STATUS ──────────────────────────────────────
const renderCajaChart = (period) => {
    const periodData = rawProrrateo.filter(item => item.periodo === period);

    const pagos = periodData.reduce((sum, item) => sum + (item.pagos || 0), 0);
    const impagos = periodData.reduce((sum, item) => sum + (item.deuda || 0), 0);

    const series = [Math.round(pagos), Math.round(impagos)];
    const labels = ["Cobrado", "Deuda Pendiente"];
    const colors = ["#10b981", "#f43f5e"];

    const opts = {
        series,
        labels,
        chart: { type: 'donut', height: 230, background: 'transparent', fontFamily: 'Inter, sans-serif' },
        colors,
        stroke: { show: false },
        legend: { show: true, position: 'bottom', labels: { colors: '#94a3b8' } },
        dataLabels: { enabled: false },
        plotOptions: { pie: { donut: { size: '65%', labels: {
            show: true,
            name: { show: true, color: '#94a3b8' },
            value: { show: true, color: '#f1f5f9', fontSize: '1rem', fontWeight: '700' },
            total: { show: true, label: 'Total', color: '#94a3b8', formatter: (w) => {
                const t = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                return fmt(t);
            }}
        }}}},
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartCaja) chartCaja.destroy();
    chartCaja = new ApexCharts(document.querySelector("#cajaChart"), opts);
    chartCaja.render();
};

// ── TABLE RENDERER ───────────────────────────────────────────────
const renderTable = () => {
    const tbody = document.getElementById("prorrateoTableBody");
    const sorted = [...filteredProrrateo].sort((a, b) => a.uf - b.uf);

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--text-3);padding:2rem;">No se encontraron registros de prorrateo.</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(item => {
        return `
        <tr class="uf-row" onclick="openModal(${item.uf})">
            <td style="font-weight:600;">${String(item.uf).padStart(3, '0')}</td>
            <td style="color:var(--text-2);">${item.piso || '-'}</td>
            <td>${item.dpto || '-'}</td>
            <td style="text-align:right;color:var(--text-3);">${fmt(item.saldo_anterior)}</td>
            <td style="text-align:right;color:var(--green);font-weight:500;">${(item.pagos || 0) > 0 ? fmt(item.pagos) : '—'}</td>
            <td style="text-align:right;color:var(--red);font-weight:500;">${(item.deuda || 0) > 0 ? fmt(item.deuda) : '—'}</td>
            <td style="text-align:right;color:var(--purple);">${(item.interes || 0) > 0 ? fmt(item.interes) : '—'}</td>
            <td style="text-align:right;">${fmt(item.ga_monto)}</td>
            <td style="text-align:right;">${(item.gastos_extra || 0) > 0 ? fmt(item.gastos_extra) : '—'}</td>
            <td style="text-align:right;color:var(--text-3);">${(item.red_ajustes || 0) !== 0 ? fmt(item.red_ajustes) : '—'}</td>
            <td style="text-align:right;font-weight:700;color:var(--accent);">${fmt(item.total)}</td>
        </tr>`;
    }).join('');
};

// ── MODAL DETALLE U.F. ───────────────────────────────────────────
const openModal = (ufNum) => {
    const ufRecords = rawProrrateo
        .filter(item => item.uf === ufNum)
        .sort((a, b) => a.periodo.localeCompare(b.periodo));

    if (ufRecords.length === 0) return;

    const latest = ufRecords[ufRecords.length - 1];

    const ubiLabel = (latest.piso && latest.piso !== latest.dpto)
        ? `Piso ${latest.piso}, Dpto ${latest.dpto}`
        : `Dpto ${latest.dpto}`;

    document.getElementById("modalTitle").textContent = `U.F. ${String(latest.uf).padStart(3, '0')} — ${ubiLabel}`;
    document.getElementById("modalSubtitle").textContent = `Historial de Prorrateo y Liquidación`;
    document.getElementById("modalSubtitle").textContent = `Historial de Prorrateo y Liquidación`;

    // Coeficiente GA
    document.getElementById("modalCoefA").textContent = `${(latest.ga_pct || 0).toFixed(4)}%`;

    // Promedio histórico
    const histTotal = ufRecords.reduce((s, e) => s + (e.total || 0), 0);
    const avgTotal = ufRecords.length > 0 ? histTotal / ufRecords.length : 0;
    document.getElementById("modalCoefB").textContent = fmt(avgTotal);

    // Estado de pago
    const isDeudor = (latest.deuda || 0) > 0;
    const badge = document.getElementById("modalStatusBadge");
    if (isDeudor) {
        badge.textContent = `Debe ${fmt(latest.deuda)}`;
        badge.style.color = "var(--red)";
    } else {
        badge.textContent = "Al Día";
        badge.style.color = "var(--green)";
    }

    // Auditoría de intereses por mora
    const auditDiv = document.getElementById("modalInterestAudit");
    const warnings = [];
    const normalChecks = [];

    for (let i = 0; i < ufRecords.length; i++) {
        const curr = ufRecords[i];
        const baseDeuda = (curr.saldo_anterior || 0) - (curr.pagos || 0);
        if ((curr.interes || 0) > 0 && baseDeuda > 0) {
            const tasa = (curr.interes / baseDeuda) * 100;
            if (tasa > 3.05) {
                warnings.push({ periodo: curr.periodo, interes: curr.interes, baseDeuda, tasa });
            } else {
                normalChecks.push({ periodo: curr.periodo, interes: curr.interes, baseDeuda, tasa });
            }
        }
    }

    if (warnings.length > 0) {
        auditDiv.style.display = "block";
        auditDiv.innerHTML = `
            <div style="background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.2); border-radius:10px; padding:0.8rem 1rem;">
                <h4 style="font-size:0.85rem; color:var(--red); margin:0 0 0.4rem 0; display:flex; align-items:center; gap:6px;">⚠️ Cargo Excesivo de Intereses Detectado</h4>
                <div style="font-size:0.75rem; color:var(--text-2); line-height:1.45;">
                    Se detectaron meses con recargos por mora que exceden el límite del 3.0% mensual:
                    <ul style="margin:6px 0 0 16px; padding:0; display:flex; flex-direction:column; gap:4px;">
                        ${warnings.map(w => `
                            <li>En <strong>${w.periodo}</strong> se cobró un interés de <strong>${fmt(w.interes)}</strong> sobre una deuda de ${fmt(w.baseDeuda)}, lo que equivale a una tasa del <strong>${w.tasa.toFixed(2)}%</strong> mensual.</li>
                        `).join('')}
                    </ul>
                </div>
            </div>
        `;
    } else if (normalChecks.length > 0) {
        auditDiv.style.display = "block";
        auditDiv.innerHTML = `
            <div style="background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.2); border-radius:10px; padding:0.8rem 1rem;">
                <h4 style="font-size:0.85rem; color:var(--green); margin:0 0 0.4rem 0; display:flex; align-items:center; gap:6px;">✅ Intereses Auditados Correctamente</h4>
                <div style="font-size:0.75rem; color:var(--text-2); line-height:1.4;">
                    Los recargos por mora cobrados a esta unidad se ajustan al límite reglamentario (tasa promedio aplicada: <strong>${(normalChecks.reduce((a,b) => a + b.tasa, 0) / normalChecks.length).toFixed(2)}%</strong> mensual).
                </div>
            </div>
        `;
    } else {
        auditDiv.style.display = "none";
    }

    // Historial
    const historyList = document.getElementById("ufHistoryList");
    historyList.innerHTML = [...ufRecords].reverse().map(e => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:8px; padding:0.6rem 0.8rem; font-size:0.8rem;">
            <div>
                <span style="font-weight:600; color:var(--text-1);">${e.periodo}</span>
                <span style="margin-left:8px; color:var(--text-3);">Facturado: ${fmt(e.total)}</span>
            </div>
            <div style="font-weight:600; color:${(e.deuda || 0) > 0 ? 'var(--red)' : 'var(--green)'};">
                ${(e.deuda || 0) > 0 ? 'Deuda: ' + fmt(e.deuda) : 'Pagado: ' + fmt(e.pagos)}
            </div>
        </div>
    `).join('');

    // Gráfico evolución expensas
    const seriesData = ufRecords.map(e => Math.round(e.total || 0));
    const categories = ufRecords.map(e => e.periodo);

    const totalPeriods = categories.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series: [{ name: 'Expensas Facturadas', data: seriesData }],
        chart: {
            type: 'area', height: 230, foreColor: '#94a3b8',
            toolbar: { show: true, tools: { download: false, selection: false, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true } },
            zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
            background: 'transparent'
        },
        stroke: { curve: 'smooth', width: 2 },
        colors: ['#06b6d4'],
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.05 } },
        dataLabels: { enabled: false },
        xaxis: { type: 'category', categories: categories, min: minIndex, max: maxIndex },
        yaxis: { labels: { formatter: v => fmt(v) } },
        grid: { borderColor: 'rgba(255,255,255,0.05)' },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartUfHistory) chartUfHistory.destroy();
    chartUfHistory = new ApexCharts(document.querySelector("#ufHistoryChart"), opts);
    chartUfHistory.render().then(() => {
        setTimeout(() => {
            if (chartUfHistory) chartUfHistory.zoomX(minIndex, maxIndex);
        }, 100);
    });

    document.getElementById("ufModal").classList.add("open");
};

const closeModal = () => {
    document.getElementById("ufModal").classList.remove("open");
};

// ── EXPORT CSV ──────────────────────────────────────────────────
const exportCSV = () => {
    const headers = ["Periodo", "UF", "Dpto", "Saldo Anterior", "Pagado", "Deuda", "Interes", "Gastos A (GA)", "Gastos B (GB)", "Fondo Operativo", "Total"];
    const rows = filteredProrrateo.map(e => [
        e.periodo,
        e.uf,
        e.dpto,
        (e.saldo_anterior || 0).toFixed(2),
        (e.pagos || 0).toFixed(2),
        (e.deuda || 0).toFixed(2),
        (e.interes || 0).toFixed(2),
        (e.ga_monto || 0).toFixed(2),
        (e.gb_monto || 0).toFixed(2),
        (e.fondo_operativo_monto || 0).toFixed(2),
        (e.total || 0).toFixed(2)
    ]);

    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `alvear963_prorrateo_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

// ── EXPORT PDF ──────────────────────────────────────────────────
const exportPDF = () => {
    window.print();
};

// ── SERVICES STATUS MONITOR ─────────────────────────────────────
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
                    return `<span class="badge badge-warning" style="white-space: nowrap; font-size:0.65rem;">⚠️ Alerta</span>`;
                }
                return `<span class="badge badge-success" style="white-space: nowrap; font-size:0.65rem;">🟢 Normal</span>`;
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
                <div style="font-size: 0.6rem; color: var(--text-3); text-align: right; margin-top: 6px; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 4px;">Act: ${data.actualizado || 'N/D'}</div>
            `;
        })
        .catch(err => {
            console.warn("No se pudo cargar el estado de servicios:", err);
            container.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-3);">Estado no disponible</span>`;
        });
};
