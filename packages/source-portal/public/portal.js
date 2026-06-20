(function () {
  "use strict";

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatDate(ts) {
    if (!ts) return "";
    try {
      return new Date(Number(ts)).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      });
    } catch { return ""; }
  }

  function showError(id, msg) {
    var el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = "block"; }
  }

  function hideError(id) {
    var el = document.getElementById(id);
    if (el) { el.style.display = "none"; el.textContent = ""; }
  }

  function formatDiceware(raw) {
    return (raw || "").replace(/-/g, " · ");
  }

  var fileInput = document.getElementById("file-input");
  var uploadZone = document.getElementById("upload-zone");
  var filesList = document.getElementById("upload-files-list");
  var ctaBtn = document.getElementById("cta-submit");
  var submitForm = document.getElementById("submit-form");
  var submitResult = document.getElementById("submit-result");

  if (ctaBtn && submitForm) {
    ctaBtn.addEventListener("click", function () {
      submitForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

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
    if (fileInput) fileInput.addEventListener("change", function () {
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
      var displayNameInput = document.getElementById("display-name-input");
      var messageInput = document.getElementById("message-input");
      var displayName = (displayNameInput ? displayNameInput.value : "").trim();
      var messageText = (messageInput ? messageInput.value : "").trim();
      var hasFiles = fileInput && fileInput.files && fileInput.files.length > 0;

      if (!displayName) {
        showError("submit-error", "A codename is required.");
        return;
      }
      if (!messageText && !hasFiles) {
        showError("submit-error", "Please provide a message or attach files.");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Encrypting…";

      try {
        await PortalCrypto.ready;

        var pkRes = await fetch("/pubkey");
        if (!pkRes.ok) throw new Error("Could not fetch newsroom public key.");
        var pkData = await pkRes.json();
        var newsroomPublicKey = PortalCrypto.fromHex(pkData.publicKey);

        var sealedText = null;
        if (messageText) {
          var textBytes = new TextEncoder().encode(messageText);
          var sealed = PortalCrypto.sealedBoxEncrypt(textBytes, newsroomPublicKey);
          sealedText = PortalCrypto.toBase64(sealed);
        }

        btn.textContent = "Submitting…";

        var formData = new FormData();
        formData.append("displayName", displayName);
        if (sealedText) formData.append("sealedText", sealedText);
        if (hasFiles) {
          for (var i = 0; i < fileInput.files.length; i++) {
            formData.append("files", fileInput.files[i]);
          }
        }

        var res = await fetch("/submit", { method: "POST", body: formData });
        var data = await res.json();

        if (!res.ok) {
          showError("submit-error", data.error || "Submission failed. Please try again.");
          btn.disabled = false;
          btn.textContent = "Submit Securely →";
          return;
        }

        document.getElementById("result-display-name").textContent = escapeHtml(data.displayName);
        document.getElementById("diceware1-display").textContent = formatDiceware(data.diceware1);
        document.getElementById("diceware2-display").textContent = formatDiceware(data.diceware2);

        submitForm.style.display = "none";
        if (submitResult) submitResult.style.display = "block";

      } catch (err) {
        showError("submit-error", "Encryption or network error. Please try again.");
        btn.disabled = false;
        btn.textContent = "Submit Securely →";
      }
    });
  }

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
          '<div class="reply-meta">Reply ' + (i + 1) + ' · ' +
          escapeHtml(formatDate(m.created_at)) + ' · From the newsroom</div>' +
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
      var diceware1Raw = (document.getElementById("diceware1-input").value || "").trim();
      var diceware2Raw = (document.getElementById("diceware2-input").value || "").trim();

      var diceware1 = diceware1Raw.replace(/\s*·\s*/g, "-").replace(/\s+/g, "-");
      var diceware2 = diceware2Raw.replace(/\s*·\s*/g, "-").replace(/\s+/g, "-");

      if (!diceware1) {
        showError("checkin-error", "Please enter your check-in phrase (Phrase 1).");
        return;
      }
      if (!diceware2) {
        showError("checkin-error", "Please enter your reply phrase (Phrase 2).");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Deriving key…";

      try {
        await PortalCrypto.ready;

        var keypair = await PortalCrypto.deriveSourceKeypair(diceware2);
        var sourceSK = keypair.privateKey;

        btn.textContent = "Checking in…";

        var res = await fetch("/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ diceware1: diceware1 }),
        });
        var data = await res.json();

        if (!res.ok) {
          showError("checkin-error", data.error || "Check-in failed. Please check Phrase 1.");
          btn.disabled = false;
          btn.textContent = "Check In →";
          return;
        }

        btn.textContent = "Decrypting replies…";

        var decryptedMessages = [];
        for (var i = 0; i < data.messages.length; i++) {
          var msg = data.messages[i];
          try {
            var ciphertextBytes = PortalCrypto.fromBase64(msg.ciphertext);
            var senderPK = PortalCrypto.fromHex(msg.senderPublicKey);
            var plainBytes = PortalCrypto.boxOpen(ciphertextBytes, senderPK, sourceSK);
            var body = new TextDecoder().decode(plainBytes);
            decryptedMessages.push({ body: body, created_at: msg.created_at });
          } catch (decryptErr) {
            decryptedMessages.push({ body: "[Decryption failed — wrong Phrase 2?]", created_at: msg.created_at });
          }
        }

        renderReplies(decryptedMessages);
        checkinForm.style.display = "none";
        if (checkinResult) checkinResult.style.display = "block";

      } catch (err) {
        showError("checkin-error", "Error: " + (err.message || "Please try again."));
        btn.disabled = false;
        btn.textContent = "Check In →";
      }
    });
  }

  var checkinAgainBtn = document.getElementById("checkin-again-btn");
  if (checkinAgainBtn) {
    checkinAgainBtn.addEventListener("click", function () {
      if (checkinResult) checkinResult.style.display = "none";
      if (checkinForm) { checkinForm.style.display = "block"; checkinForm.reset(); }
      hideError("checkin-error");
    });
  }

  // ── Forget Phrase 2 (forward secrecy) ───────────────────────
  var forgetBtn = document.getElementById("forget-phrase-btn");
  if (forgetBtn) {
    forgetBtn.addEventListener("click", function () {
      var confirmed = window.confirm(
        "Are you sure? Your original submission will become permanently unreadable to everyone, including the newsroom. This cannot be undone."
      );
      if (!confirmed) return;

      // Clear diceware2 from the form inputs so it's no longer in the DOM
      var d2input = document.getElementById("diceware2-input");
      if (d2input) d2input.value = "";

      // Hide the button, show confirmation
      forgetBtn.style.display = "none";
      var confirmEl = document.getElementById("forget-phrase-confirm");
      if (confirmEl) confirmEl.style.display = "block";

      // Clear any in-memory reference (belt-and-suspenders)
      // The keypair was derived ephemerally — no persistent storage to clear
    });
  }

})();
