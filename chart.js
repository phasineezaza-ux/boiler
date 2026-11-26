/**
 * ============================================================================
 * chart.js — กราฟเส้นแนวโน้มแรงดันไอน้ำ พร้อมแถบสีและเส้นเกณฑ์ 7.1 / 7.6 Bar
 * ============================================================================
 * - ใช้ Chart.js (ถ้าโหลด CDN ไม่สำเร็จ จะสลับไปใช้กราฟ SVG ในตัวอัตโนมัติ)
 * - วาดแถบสีพื้นหลังและเส้นประบอกเกณฑ์ 7.1 และ 7.6 Bar ชัดเจน
 */

(function (global) {
  'use strict';

  let chartInstance = null;

  /**
   * ปลั๊กอิน Chart.js สำหรับวาดโซนสีและเส้นประเกณฑ์ 7.1 / 7.6 (และ High Alarm ถ้าเปิดใช้)
   */
  const thresholdBandsPlugin = {
    id: 'boilerThresholdBands',
    beforeDatasetsDraw: function (chart, _args, pluginOptions) {
      const ctx = chart.ctx;
      const chartArea = chart.chartArea;
      const yScale = chart.scales.y;
      if (!chartArea || !yScale) return;

      const normalMin = pluginOptions.normalMin;
      const warningMin = pluginOptions.warningMin;
      const highEnabled = pluginOptions.highAlarmEnabled;
      const highMax = pluginOptions.highAlarmMax;

      const yTop = chartArea.top;
      const yBottom = chartArea.bottom;
      const xLeft = chartArea.left;
      const xRight = chartArea.right;
      const width = xRight - xLeft;

      const clampY = function (val) {
        const px = yScale.getPixelForValue(val);
        return Math.max(yTop, Math.min(yBottom, px));
      };

      const yNormal = clampY(normalMin);
      const yWarning = clampY(warningMin);

      ctx.save();

      // 1) โซนปกติ (>= 7.6 Bar) — เขียวอ่อน
      if (highEnabled && typeof highMax === 'number') {
        const yHigh = clampY(highMax);
        // โซนแรงดันสูง (> highMax) — แดงอ่อน
        if (yHigh > yTop) {
          ctx.fillStyle = 'rgba(220, 38, 38, 0.08)';
          ctx.fillRect(xLeft, yTop, width, yHigh - yTop);
        }
        if (yNormal > yHigh) {
          ctx.fillStyle = 'rgba(22, 163, 74, 0.07)';
          ctx.fillRect(xLeft, yHigh, width, yNormal - yHigh);
        }
      } else if (yNormal > yTop) {
        ctx.fillStyle = 'rgba(22, 163, 74, 0.07)';
        ctx.fillRect(xLeft, yTop, width, yNormal - yTop);
      }

      // 2) โซนเตือนระยะแรก (7.1 – < 7.6 Bar) — เหลืองอ่อน
      if (yWarning > yNormal) {
        ctx.fillStyle = 'rgba(217, 119, 6, 0.10)';
        ctx.fillRect(xLeft, yNormal, width, yWarning - yNormal);
      }

      // 3) โซน Alarm (< 7.1 Bar) — แดงอ่อน
      if (yBottom > yWarning) {
        ctx.fillStyle = 'rgba(220, 38, 38, 0.07)';
        ctx.fillRect(xLeft, yWarning, width, yBottom - yWarning);
      }

      // 4) เส้นประและป้ายชื่อเกณฑ์
      drawHorizontalLine(ctx, xLeft, xRight, yNormal, '#15803d', 'เกณฑ์ปกติ ' + normalMin.toFixed(1) + ' Bar', yTop, yBottom);
      drawHorizontalLine(ctx, xLeft, xRight, yWarning, '#b91c1c', 'เกณฑ์ Alarm ' + warningMin.toFixed(1) + ' Bar', yTop, yBottom);

      if (highEnabled && typeof highMax === 'number') {
        const yHigh = clampY(highMax);
        drawHorizontalLine(ctx, xLeft, xRight, yHigh, '#b91c1c', 'แรงดันสูงสุด ' + highMax.toFixed(1) + ' Bar', yTop, yBottom);
      }

      ctx.restore();
    }
  };

  function drawHorizontalLine(ctx, xLeft, xRight, y, color, label, yTop, yBottom) {
    if (y <= yTop || y >= yBottom) return;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.moveTo(xLeft, y);
    ctx.lineTo(xRight, y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.font = '600 11px "Noto Sans Thai", system-ui, sans-serif';
    const textW = ctx.measureText(label).width;
    const padX = 6;
    const boxW = textW + padX * 2;
    const boxH = 18;
    const labelY = Math.max(yTop + 2, y - boxH - 3);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillRect(xRight - boxW - 6, labelY, boxW, boxH);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, xRight - boxW - 6 + padX, labelY + boxH / 2);
    ctx.restore();
  }

  /**
   * วาดกราฟแนวโน้มจากจุดข้อมูล
   */
  function renderTrendChart(points, thresholds, spanDays) {
    const canvas = document.getElementById('pressureChart');
    const emptyEl = document.getElementById('chartEmptyState');
    const fallbackEl = document.getElementById('chartSvgFallback');

    if (!canvas) return;

    if (!points || points.length === 0) {
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
      canvas.style.display = 'none';
      if (fallbackEl) fallbackEl.style.display = 'none';
      if (emptyEl) emptyEl.style.display = 'flex';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // ถ้าโหลด Chart.js ไม่ได้ (เช่น ไม่มีเน็ต) ให้ใช้ SVG สำรอง
    if (typeof global.Chart === 'undefined') {
      canvas.style.display = 'none';
      if (fallbackEl) {
        fallbackEl.style.display = 'block';
        renderSvgFallbackChart(fallbackEl, points, thresholds);
      }
      return;
    }

    canvas.style.display = 'block';
    if (fallbackEl) fallbackEl.style.display = 'none';

    const labels = points.map(function (p) {
      return formatChartLabel(p.timestamp, spanDays);
    });
    const values = points.map(function (p) {
      return p.value;
    });

    // คำนวณขอบบน-ล่างของแกน Y ให้เห็นเส้นเกณฑ์ 7.1 และ 7.6 ชัดเจนเสมอ
    const maxData = Math.max.apply(null, values.concat([thresholds.normalMin + 1.0]));
    const yMax = Math.ceil(Math.max(10, maxData + 0.5));

    const dataConfig = {
      labels: labels,
      datasets: [
        {
          label: 'แรงดันไอน้ำ (Bar)',
          data: values,
          borderColor: '#0f4c81',
          backgroundColor: 'rgba(15, 76, 129, 0.08)',
          borderWidth: 2.2,
          pointRadius: points.length <= 40 ? 3 : 0,
          pointHoverRadius: 5,
          pointBackgroundColor: function (ctx) {
            const v = ctx.raw;
            if (v === thresholds.stopValue) return '#64748b';
            if (thresholds.highAlarm && thresholds.highAlarm.enabled && v > thresholds.highAlarm.maxBar) return '#dc2626';
            if (v >= thresholds.normalMin) return '#16a34a';
            if (v >= thresholds.warningMin) return '#d97706';
            return '#dc2626';
          },
          tension: 0.2,
          fill: false
        }
      ]
    };

    const optionsConfig = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.94)',
          titleFont: { family: '"Noto Sans Thai", sans-serif', size: 13 },
          bodyFont: { family: '"Noto Sans Thai", sans-serif', size: 13 },
          padding: 10,
          callbacks: {
            title: function (items) {
              if (!items.length) return '';
              const p = points[items[0].dataIndex];
              return formatFullThaiDateTime(p.timestamp);
            },
            label: function (ctx) {
              const p = points[ctx.dataIndex];
              const lines = ['ค่าแรงดัน: ' + Number(p.value).toFixed(1) + ' Bar'];
              if (p.count && p.count > 1) {
                lines.push('ต่ำสุด–สูงสุดในช่วง: ' + Number(p.min).toFixed(1) + ' – ' + Number(p.max).toFixed(1) + ' Bar (' + p.count + ' จุด)');
              }
              return lines;
            }
          }
        },
        boilerThresholdBands: {
          normalMin: thresholds.normalMin,
          warningMin: thresholds.warningMin,
          highAlarmEnabled: Boolean(thresholds.highAlarm && thresholds.highAlarm.enabled),
          highAlarmMax: thresholds.highAlarm ? thresholds.highAlarm.maxBar : 10.0
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 7,
            font: { family: '"Noto Sans Thai", sans-serif', size: 11 },
            color: '#475569'
          }
        },
        y: {
          min: 0,
          max: yMax,
          grid: { color: 'rgba(148, 163, 184, 0.25)' },
          ticks: {
            stepSize: 2,
            font: { family: '"Noto Sans Thai", sans-serif', size: 11 },
            color: '#475569',
            callback: function (v) { return v + ' Bar'; }
          }
        }
      }
    };

    if (chartInstance) {
      chartInstance.data = dataConfig;
      chartInstance.options = optionsConfig;
      chartInstance.update('none');
      return;
    }

    chartInstance = new global.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: dataConfig,
      options: optionsConfig,
      plugins: [thresholdBandsPlugin]
    });
  }

  /**
   * กราฟ SVG สำรองกรณีเปิดใช้งานออฟไลน์และโหลด Chart.js CDN ไม่ได้
   */
  function renderSvgFallbackChart(container, points, thresholds) {
    const w = 700;
    const h = 240;
    const pad = { top: 16, right: 16, bottom: 28, left: 42 };
    const innerW = w - pad.left - pad.right;
    const innerH = h - pad.top - pad.bottom;

    const maxV = Math.max(10, Math.max.apply(null, points.map(function (p) { return p.value; })) + 0.5);
    const toX = function (i) {
      if (points.length === 1) return pad.left + innerW / 2;
      return pad.left + (i / (points.length - 1)) * innerW;
    };
    const toY = function (v) {
      return pad.top + innerH - (v / maxV) * innerH;
    };

    const pathD = points.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + toX(i).toFixed(1) + ',' + toY(p.value).toFixed(1);
    }).join(' ');

    const yNormal = toY(thresholds.normalMin).toFixed(1);
    const yWarn = toY(thresholds.warningMin).toFixed(1);

    container.innerHTML =
      '<svg viewBox="0 0 ' + w + ' ' + h + '" class="svg-fallback-chart" role="img" aria-label="กราฟแนวโน้มแรงดันไอน้ำ">' +
      '<line x1="' + pad.left + '" y1="' + yNormal + '" x2="' + (w - pad.right) + '" y2="' + yNormal + '" stroke="#15803d" stroke-dasharray="5,4" stroke-width="1.5"/>' +
      '<line x1="' + pad.left + '" y1="' + yWarn + '" x2="' + (w - pad.right) + '" y2="' + yWarn + '" stroke="#b91c1c" stroke-dasharray="5,4" stroke-width="1.5"/>' +
      '<path d="' + pathD + '" fill="none" stroke="#0f4c81" stroke-width="2.2"/>' +
      '<text x="' + (pad.left + 4) + '" y="' + (Number(yNormal) - 4) + '" font-size="11" fill="#15803d">ปกติ ' + thresholds.normalMin + '</text>' +
      '<text x="' + (pad.left + 4) + '" y="' + (Number(yWarn) + 12) + '" font-size="11" fill="#b91c1c">Alarm ' + thresholds.warningMin + '</text>' +
      '</svg>';
  }

  function formatChartLabel(isoStr, spanDays) {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return String(isoStr || '');
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    const dd = pad2(d.getDate());
    const mm = pad2(d.getMonth() + 1);
    if (spanDays <= 1) {
      return hh + ':' + mi;
    }
    return dd + '/' + mm + ' ' + hh + ':' + mi;
  }

  function formatFullThaiDateTime(isoStr) {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return String(isoStr || '');
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  global.BoilerChart = {
    renderTrendChart: renderTrendChart
  };
})(window);
