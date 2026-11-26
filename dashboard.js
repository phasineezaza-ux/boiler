/**
 * ============================================================================
 * dashboard.js — ส่วนแสดงผล UI (DOM Rendering) สำหรับหน้าจอภาษาไทย
 * ============================================================================
 * แยกหน้าที่เฉพาะการอัปเดตหน้าจอ การจัดรูปแบบวัน-เวลา และไอคอนสถานะ
 */

(function (global) {
  'use strict';

  const ICONS = {
    NORMAL:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    WARNING:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    ALARM_LOW:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    ALARM_HIGH:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    STOP:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>',
    DISCONNECTED:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
    INVALID:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };

  function getIconHtml(code) {
    return ICONS[code] || ICONS.INVALID;
  }

  /**
   * เติมรายการจุดติดตั้งลงใน Dropdown จาก config.js
   */
  function renderStationDropdown(selectEl, stations, selectedId) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    stations.forEach(function (st) {
      const opt = document.createElement('option');
      opt.value = st.id;
      opt.textContent = st.name;
      opt.disabled = !st.enabled;
      if (st.id === selectedId) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  /**
   * อัปเดตการ์ดสถานะแรงดันปัจจุบัน
   */
  function renderCurrentStatusCard(evaluated, thresholds, stationName) {
    const card = document.getElementById('statusHeroCard');
    const captionEl = document.getElementById('heroStationCaption');
    const badge = document.getElementById('statusBadge');
    const badgeIcon = document.getElementById('statusBadgeIcon');
    const badgeText = document.getElementById('statusBadgeText');
    const pressureVal = document.getElementById('currentPressureValue');
    const pressureUnit = document.getElementById('currentPressureUnit');
    const descEl = document.getElementById('statusDescription');
    const updatedEl = document.getElementById('lastUpdatedText');
    const staleBanner = document.getElementById('staleWarningBanner');
    const staleBannerText = document.getElementById('staleWarningText');
    const rulesHint = document.getElementById('thresholdRulesHint');

    if (!card) return;
    if (captionEl && stationName) {
      captionEl.textContent = 'แรงดันไอน้ำปัจจุบัน — ' + stationName;
    }

    // ล้าง class สีเก่าทั้งหมดก่อนใส่ class ใหม่
    card.classList.remove(
      'status-normal', 'status-warning', 'status-alarm',
      'status-stop', 'status-disconnected', 'status-invalid'
    );
    card.classList.add(evaluated.colorClass);

    if (badge) {
      badge.className = 'status-badge ' + evaluated.colorClass;
    }
    if (badgeIcon) {
      badgeIcon.innerHTML = getIconHtml(evaluated.code);
    }
    if (badgeText) {
      badgeText.textContent = evaluated.label;
    }

    if (pressureVal) {
      pressureVal.textContent = evaluated.displayValue;
    }
    if (pressureUnit) {
      pressureUnit.textContent = evaluated.unit || 'Bar';
    }
    if (descEl) {
      descEl.textContent = evaluated.description;
    }

    // แสดงเวลาอัปเดตล่าสุด + ระยะเวลาที่ผ่านมา
    if (updatedEl) {
      if (evaluated.lastTimestamp) {
        const formatted = formatDateTimeDisplay(evaluated.lastTimestamp);
        const ageText = global.BoilerEvaluator.formatDurationThai(evaluated.ageSeconds);
        updatedEl.textContent = 'อัปเดตล่าสุด: ' + formatted + ' (ผ่านมา ' + ageText + ')';
      } else {
        updatedEl.textContent = 'อัปเดตล่าสุด: ไม่พบข้อมูลเวลา';
      }
    }

    // แบนเนอร์เตือนเมื่อขาดการติดต่อ (> 3 นาที) — ย้ำว่าไม่แสดงค่าเก่าเป็นค่าปัจจุบัน
    if (staleBanner && staleBannerText) {
      if (evaluated.isStale) {
        staleBanner.style.display = 'flex';
        const lastKnownStr = (typeof evaluated.lastKnownValue === 'number')
          ? ' (ค่าล่าสุดที่เคยรับได้คือ ' + evaluated.lastKnownValue.toFixed(1) + ' Bar)'
          : '';
        staleBannerText.textContent =
          'ข้อมูลเก่ากว่า ' + thresholds.staleMinutes + ' นาที ระบบซ่อนตัวเลขปัจจุบันเพื่อป้องกันความสับสน' + lastKnownStr;
      } else {
        staleBanner.style.display = 'none';
      }
    }

    if (rulesHint) {
      let hint = 'ปกติ >= ' + thresholds.normalMin.toFixed(1) +
        ' | เตือน ' + thresholds.warningMin.toFixed(1) + '–<' + thresholds.normalMin.toFixed(1) +
        ' | Alarm < ' + thresholds.warningMin.toFixed(1) +
        ' | หยุดเดิน = 0 Bar';
      if (thresholds.highAlarm && thresholds.highAlarm.enabled) {
        hint += ' | แรงดันสูง > ' + thresholds.highAlarm.maxBar.toFixed(1) + ' Bar';
      }
      rulesHint.textContent = hint;
    }
  }

  /**
   * อัปเดตส่วนสรุป Min / Avg / Max และตารางบันทึกล่าสุด
   */
  function renderHistorySection(historyData, thresholds) {
    const minEl = document.getElementById('summaryMin');
    const avgEl = document.getElementById('summaryAvg');
    const maxEl = document.getElementById('summaryMax');
    const countEl = document.getElementById('summaryCountInfo');
    const aggEl = document.getElementById('chartAggregationBadge');
    const tbody = document.getElementById('recentLogsBody');

    const s = (historyData && historyData.summary) ? historyData.summary : {};

    if (minEl) minEl.textContent = (typeof s.min === 'number') ? s.min.toFixed(1) : '--';
    if (avgEl) avgEl.textContent = (typeof s.avg === 'number') ? s.avg.toFixed(2) : '--';
    if (maxEl) maxEl.textContent = (typeof s.max === 'number') ? s.max.toFixed(1) : '--';

    if (countEl) {
      const valid = s.validCount || 0;
      const invalid = s.invalidCount || 0;
      countEl.textContent = 'ข้อมูลถูกต้อง ' + valid.toLocaleString('th-TH') + ' รายการ' +
        (invalid > 0 ? ' (อ่านค่าไม่ได้ ' + invalid + ' รายการ)' : '');
    }

    if (aggEl && historyData) {
      const aggMap = {
        raw: 'ความละเอียด 1 นาที',
        '5m': 'เฉลี่ยทุก 5 นาที',
        '2h': 'เฉลี่ยทุก 2 ชม.',
        hourly: 'เฉลี่ยรายชั่วโมง',
        '6h': 'เฉลี่ยทุก 6 ชม.',
        daily: 'เฉลี่ยรายวัน'
      };
      aggEl.textContent = aggMap[historyData.aggregation] || 'สรุปช่วงเวลา';
    }

    if (!tbody) return;
    const logs = (historyData && Array.isArray(historyData.recentLogs)) ? historyData.recentLogs : [];
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="table-empty">ไม่พบข้อมูลในช่วงวันที่ที่เลือก</td></tr>';
      return;
    }

    const fragment = document.createDocumentFragment();
    logs.forEach(function (row) {
      const tr = document.createElement('tr');
      const evalRes = row.isValid === false
        ? {
            code: 'INVALID',
            shortLabel: 'อ่านค่าไม่ได้',
            colorClass: 'status-invalid',
            value: null
          }
        : global.BoilerEvaluator.evaluatePressureValue(row.value, thresholds);

      const tdTime = document.createElement('td');
      tdTime.textContent = formatDateTimeDisplay(row.timestamp, row.date, row.time);

      const tdVal = document.createElement('td');
      tdVal.className = 'col-num';
      tdVal.textContent = evalRes.value !== null
        ? evalRes.value.toFixed(1) + ' ' + (row.unit || 'Bar')
        : 'ผิดพลาด (' + (row.rawValue || 'ว่าง') + ')';

      const tdStatus = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = 'table-badge ' + evalRes.colorClass;
      pill.innerHTML = '<span class="table-badge-icon">' + getIconHtml(evalRes.code) + '</span>' +
        '<span>' + escapeHtml(evalRes.shortLabel) + '</span>';
      tdStatus.appendChild(pill);

      tr.appendChild(tdTime);
      tr.appendChild(tdVal);
      tr.appendChild(tdStatus);
      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  function showErrorBanner(message) {
    const box = document.getElementById('errorBanner');
    const text = document.getElementById('errorBannerText');
    if (!box || !text) return;
    if (!message) {
      box.style.display = 'none';
      return;
    }
    text.textContent = message;
    box.style.display = 'flex';
  }

  function formatDateTimeDisplay(isoStr, fallbackDate, fallbackTime) {
    if (isoStr) {
      const d = new Date(isoStr);
      if (!Number.isNaN(d.getTime())) {
        return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() +
          ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
      }
    }
    return [fallbackDate, fallbackTime].filter(Boolean).join(' ') || '-';
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  global.BoilerDashboardUI = {
    renderStationDropdown: renderStationDropdown,
    renderCurrentStatusCard: renderCurrentStatusCard,
    renderHistorySection: renderHistorySection,
    showErrorBanner: showErrorBanner
  };
})(window);
