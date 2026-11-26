/**
 * ============================================================================
 * app.js — ตัวควบคุมหลักของเว็บแอป (Controller & Auto-refresh)
 * ============================================================================
 */

(function (global) {
  'use strict';

  const state = {
    stationId: global.BOILER_CONFIG.ui.defaultStationId,
    rangeDays: global.BOILER_CONFIG.ui.defaultRangeDays || 1,
    demoScenario: 'normal',
    countdownSec: Math.floor((global.BOILER_CONFIG.api.refreshIntervalMs || 60000) / 1000),
    isLoading: false
  };

  let refreshTimerId = null;
  let countdownTimerId = null;

  function init() {
    const cfg = global.BOILER_CONFIG;
    const stationSelect = document.getElementById('stationSelect');
    global.BoilerDashboardUI.renderStationDropdown(stationSelect, cfg.stations, state.stationId);

    // ตั้งค่าวันที่เริ่มต้นใน Date Picker ตาม rangeDays
    applyPresetRange(state.rangeDays, false);

    bindEvents();
    updateModeBanner();
    refreshAll();
    startAutoRefresh();
  }

  function bindEvents() {
    const stationSelect = document.getElementById('stationSelect');
    if (stationSelect) {
      stationSelect.addEventListener('change', function () {
        state.stationId = stationSelect.value;
        refreshAll();
      });
    }

    const refreshBtn = document.getElementById('refreshNowBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        refreshAll();
      });
    }

    // ปุ่มสลับช่วงกราฟ 24 ชม. / 7 วัน / 30 วัน
    document.querySelectorAll('.range-pill').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const days = Number(btn.getAttribute('data-days'));
        applyPresetRange(days, true);
      });
    });

    // ปุ่มค้นหาตามช่วงวันที่จาก Date Picker
    const applyDateBtn = document.getElementById('applyDateFilterBtn');
    if (applyDateBtn) {
      applyDateBtn.addEventListener('click', function () {
        // เอา highlight ออกจากปุ่ม preset เมื่อเลือกวันที่เอง
        document.querySelectorAll('.range-pill').forEach(function (b) {
          b.classList.remove('active');
        });
        loadHistoryOnly();
      });
    }

    // ปุ่มจำลองสถานการณ์ (แสดงเฉพาะในโหมดทดสอบ)
    document.querySelectorAll('.demo-scenario-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.demoScenario = btn.getAttribute('data-scenario') || 'normal';
        document.querySelectorAll('.demo-scenario-btn').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        loadLatestOnly();
      });
    });

    // Modal ตั้งค่าการเชื่อมต่อ Apps Script URL & Token
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const modalBackdrop = document.getElementById('settingsModal');
    const settingsForm = document.getElementById('settingsForm');
    const resetDemoBtn = document.getElementById('resetToDemoBtn');

    if (openSettingsBtn && modalBackdrop) {
      openSettingsBtn.addEventListener('click', function () {
        const conn = global.BoilerDataService.getConnectionSettings();
        document.getElementById('inputWebAppUrl').value = conn.webAppUrl || '';
        document.getElementById('inputApiToken').value = conn.token || '';
        modalBackdrop.style.display = 'flex';
      });
    }

    if (closeSettingsBtn && modalBackdrop) {
      closeSettingsBtn.addEventListener('click', function () {
        modalBackdrop.style.display = 'none';
      });
    }

    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', function (e) {
        if (e.target === modalBackdrop) modalBackdrop.style.display = 'none';
      });
    }

    if (settingsForm) {
      settingsForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const url = document.getElementById('inputWebAppUrl').value.trim();
        const token = document.getElementById('inputApiToken').value.trim();
        global.BoilerDataService.saveConnectionSettings(url, token, false);
        modalBackdrop.style.display = 'none';
        updateModeBanner();
        refreshAll();
      });
    }

    if (resetDemoBtn) {
      resetDemoBtn.addEventListener('click', function () {
        global.BoilerDataService.clearSavedConnectionSettings();
        global.BoilerDataService.saveConnectionSettings('', '', true);
        if (modalBackdrop) modalBackdrop.style.display = 'none';
        updateModeBanner();
        refreshAll();
      });
    }

    // เมื่อสลับแท็บกลับมา ให้รีเฟรชทันทีเพื่อให้แสดงค่าล่าสุดเสมอ
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        refreshAll();
      }
    });
  }

  function applyPresetRange(days, shouldFetch) {
    state.rangeDays = days;
    document.querySelectorAll('.range-pill').forEach(function (btn) {
      btn.classList.toggle('active', Number(btn.getAttribute('data-days')) === days);
    });

    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));

    const fromInput = document.getElementById('dateFrom');
    const toInput = document.getElementById('dateTo');
    if (fromInput) fromInput.value = toYyyyMmDd(from);
    if (toInput) toInput.value = toYyyyMmDd(today);

    if (shouldFetch) {
      loadHistoryOnly();
    }
  }

  async function refreshAll() {
    resetCountdown();
    await Promise.all([loadLatestOnly(), loadHistoryOnly()]);
  }

  async function loadLatestOnly() {
    const refreshBtn = document.getElementById('refreshNowBtn');
    const stationName = getSelectedStationName();
    if (refreshBtn) refreshBtn.classList.add('is-loading');

    try {
      const latestData = await global.BoilerDataService.fetchLatest(state.stationId, state.demoScenario);
      const evaluated = global.BoilerEvaluator.evaluateLatestReading(
        latestData,
        global.BOILER_CONFIG.thresholds,
        Date.now()
      );
      global.BoilerDashboardUI.renderCurrentStatusCard(
        evaluated,
        global.BOILER_CONFIG.thresholds,
        latestData.stationName || stationName
      );
      global.BoilerDashboardUI.showErrorBanner('');
    } catch (err) {
      global.BoilerDashboardUI.showErrorBanner(err && err.message ? err.message : 'เกิดข้อผิดพลาดในการดึงข้อมูลล่าสุด');
      const fallbackEval = global.BoilerEvaluator.evaluateLatestReading(null, global.BOILER_CONFIG.thresholds, Date.now());
      global.BoilerDashboardUI.renderCurrentStatusCard(fallbackEval, global.BOILER_CONFIG.thresholds, stationName);
    } finally {
      if (refreshBtn) refreshBtn.classList.remove('is-loading');
    }
  }

  function getSelectedStationName() {
    const list = global.BOILER_CONFIG.stations || [];
    const found = list.find(function (s) { return s.id === state.stationId; });
    return found ? found.name : state.stationId;
  }

  async function loadHistoryOnly() {
    const fromInput = document.getElementById('dateFrom');
    const toInput = document.getElementById('dateTo');
    const fromStr = fromInput ? fromInput.value : toYyyyMmDd(new Date());
    const toStr = toInput ? toInput.value : toYyyyMmDd(new Date());

    if (!fromStr || !toStr || fromStr > toStr) {
      global.BoilerDashboardUI.showErrorBanner('กรุณาเลือกช่วงวันที่ให้ถูกต้อง (วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด)');
      return;
    }

    const spanDays = Math.max(1, Math.round((new Date(toStr) - new Date(fromStr)) / (24 * 60 * 60 * 1000)) + 1);

    try {
      const historyData = await global.BoilerDataService.fetchHistory(state.stationId, fromStr, toStr);
      global.BoilerChart.renderTrendChart(historyData.points || [], global.BOILER_CONFIG.thresholds, spanDays);
      global.BoilerDashboardUI.renderHistorySection(historyData, global.BOILER_CONFIG.thresholds);
    } catch (err) {
      global.BoilerDashboardUI.showErrorBanner(err && err.message ? err.message : 'ไม่สามารถดึงข้อมูลย้อนหลังได้');
    }
  }

  function startAutoRefresh() {
    const intervalMs = global.BOILER_CONFIG.api.refreshIntervalMs || 60000;
    if (refreshTimerId) clearInterval(refreshTimerId);
    if (countdownTimerId) clearInterval(countdownTimerId);

    refreshTimerId = setInterval(function () {
      refreshAll();
    }, intervalMs);

    countdownTimerId = setInterval(function () {
      state.countdownSec = Math.max(0, state.countdownSec - 1);
      const el = document.getElementById('refreshCountdownText');
      if (el) el.textContent = 'อัปเดตอัตโนมัติใน ' + state.countdownSec + ' วินาที';
    }, 1000);
  }

  function resetCountdown() {
    state.countdownSec = Math.floor((global.BOILER_CONFIG.api.refreshIntervalMs || 60000) / 1000);
    const el = document.getElementById('refreshCountdownText');
    if (el) el.textContent = 'อัปเดตอัตโนมัติใน ' + state.countdownSec + ' วินาที';
  }

  function updateModeBanner() {
    const conn = global.BoilerDataService.getConnectionSettings();
    const demoBanner = document.getElementById('demoModeBanner');
    const connBadge = document.getElementById('connectionStatusPill');

    if (demoBanner) {
      demoBanner.style.display = conn.isDemoMode ? 'block' : 'none';
    }
    if (connBadge) {
      connBadge.textContent = conn.isDemoMode ? 'โหมดทดสอบ (ข้อมูลตัวอย่าง 30 แถว)' : 'เชื่อมต่อ Google Sheet จริง';
      connBadge.className = 'conn-pill ' + (conn.isDemoMode ? 'is-demo' : 'is-live');
    }
  }

  function toYyyyMmDd(d) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
