(function () {
  "use strict";

  // ── Utilities ────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(ts) {
    if (!ts) return "";
    try {
      return new Date(Number(ts)).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      });
    } catch { return ""; }
  }

  function showError(id, message) {
    var el = document.getElementById(id);
    if (el) { el.textContent = message; el.style.display = "block"; }
  }

  function hideError(id) {
    var el = document.getElementById(id);
    if (el) { el.style.display = "none"; el.textContent = ""; }
  }

  // ── Submit page ──────────────────────────────────────────────

  var submitForm = document.getElementById("submit-form");
  var submitResult = document.getElementById("submit-result");
  var fileInput = document.getElementById("file-input");
  var uploadZone = document.getElementById("upload-zone");
  var filesList = document.getElementById("upload-files-list");
  var ctaBtn = document.getElementById("cta-submit");

  // Scroll to form on CTA click
  if (ctaBtn && submitForm) {
    ctaBtn.addEventListener("click", function () {
      submitForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // File input click via upload zone
  if (uploadZone && fileInput) {
    uploadZone.addEventListener("click", function (e) {
      if (e.target !== fileInput) fileInput.click();
    });
    uploadZone.addEventListener("dragover", function (e) {
      e.preventDefault();
      uploadZone.style.borderColor = "var(--green)";
    });
    uploadZone.addEventListener("dragleave", function () {
      uploadZone.style.borderColor = "";
    });
    uploadZone.addEventListener("drop", function (e) {
      e.preventDefault();
      uploadZone.style.borderColor = "";
      if (e.dataTransfer && e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        renderFileList(fileInput.files);
      }
    });
    fileInput.addEventListener("change", function () {
      renderFileList(fileInput.files);
    });
  }

  function renderFileList(files) {
    if (!filesList) return;
    filesList.innerHTML = "";
    for (var i = 0; i < files.length; i++) {
      var item = document.createElement("div");
      item.className = "upload-file-item";
      item.textContent = "📄 " + escapeHtml(files[i].name);
      filesList.appendChild(item);
    }
  }

  if (submitForm) {
    submitForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      hideError("submit-error");

      var btn = document.getElementById("submit-btn");
      var textInput = document.getElementById("text-input");
      var text = textInput ? textInput.value.trim() : "";
      var files = fileInput ? fileInput.files : null;

      if (!text && (!files || files.length === 0)) {
        showError("submit-error", "Please provide a message or attach at least one file.");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Submitting…";

      var formData = new FormData();
      if (text) formData.append("text", text);
      if (files) {
        for (var i = 0; i < files.length; i++) {
          formData.append("files", files[i]);
        }
      }

      try {
        var res = await fetch("/submit", { method: "POST", body: formData });
        var data = await res.json();

        if (!res.ok) {
          showError("submit-error", data.error || "Submission failed. Please try again.");
          btn.disabled = false;
          btn.textContent = "Submit Securely →";
          return;
        }

        // Format codename: "word-word-word" → "word · word · word"
        var codename = (data.codename || "").replace(/-/g, " · ");
        document.getElementById("codename-display").textContent = codename;
        document.getElementById("passphrase-display").textContent = data.passphrase || "";

        submitForm.style.display = "none";
        if (submitResult) submitResult.style.display = "block";

      } catch (err) {
        showError("submit-error", "Network error. Please try again.");
        btn.disabled = false;
        btn.textContent = "Submit Securely →";
      }
    });
  }

  // ── Check-in page ────────────────────────────────────────────

  var checkinForm = document.getElementById("checkin-form");
  var checkinResult = document.getElementById("checkin-result");

  function renderReplies(messages) {
    var container = document.getElementById("replies-container");
    var countBadge = document.getElementById("reply-count");

    if (!container) return;

    if (!messages || messages.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><p style="margin-bottom:6px;font-size:18px;">📭</p>No replies yet. Check back later.</div>';
      if (countBadge) countBadge.textContent = "0 replies";
      return;
    }

    if (countBadge) {
      countBadge.textContent = messages.length + (messages.length === 1 ? " reply" : " replies");
    }

    container.innerHTML = messages.map(function (m, i) {
      return (
        '<div class="reply-item">' +
          '<div class="reply-meta">Reply ' + (i + 1) + ' · ' + escapeHtml(formatDate(m.created_at)) + ' · From the newsroom</div>' +
          '<div class="reply-body">' + escapeHtml(m.body) + '</div>' +
        '</div>'
      );
    }).join("");
  }

  if (checkinForm) {
    checkinForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      hideError("checkin-error");

      var btn = document.getElementById("checkin-btn");
      var codenameRaw = (document.getElementById("codename-input").value || "").trim();
      var passphrase = (document.getElementById("passphrase-input").value || "").trim();

      // Normalise "word · word · word" → "word-word-word"
      var codename = codenameRaw.replace(/\s*·\s*/g, "-").replace(/\s+/g, "-");

      if (!codename) {
        showError("checkin-error", "Please enter your codename.");
        return;
      }
      if (!passphrase) {
        showError("checkin-error", "Please enter your passphrase.");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Checking in…";

      try {
        var res = await fetch("/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codename: codename, passphrase: passphrase }),
        });
        var data = await res.json();

        if (!res.ok) {
          showError("checkin-error", data.error || "Check-in failed. Please check your credentials.");
          btn.disabled = false;
          btn.textContent = "Check In →";
          return;
        }

        renderReplies(data.messages);
        checkinForm.style.display = "none";
        if (checkinResult) checkinResult.style.display = "block";

      } catch (err) {
        showError("checkin-error", "Network error. Please try again.");
        btn.disabled = false;
        btn.textContent = "Check In →";
      }
    });
  }

  // "Check Again" reloads the form
  var checkinAgainBtn = document.getElementById("checkin-again-btn");
  if (checkinAgainBtn) {
    checkinAgainBtn.addEventListener("click", function () {
      if (checkinResult) checkinResult.style.display = "none";
      if (checkinForm) {
        checkinForm.style.display = "block";
        checkinForm.reset();
      }
      hideError("checkin-error");
    });
  }

})();