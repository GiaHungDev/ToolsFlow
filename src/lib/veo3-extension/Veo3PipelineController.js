const puppeteer = require("puppeteer-real-browser");
const path = require("path");
const fs = require("fs");
const { encrypt, decrypt } = require("./encryption");
const OTPAuth = require("otpauth");

class Veo3PipelineController {
  constructor(
    accountData,
    masterService,
    io,
    browserType = "edge",
    assignedProxy = null,
  ) {
    this.accountData = accountData;
    this.master = masterService;
    this.io = io;
    this.browserType = browserType;
    this.assignedProxy = assignedProxy;

    this.MAX_SLOTS =
      (masterService.maxVideoThreads || 0) +
      (masterService.maxImageThreads || 0);
    if (this.MAX_SLOTS <= 0) this.MAX_SLOTS = 3; // Default fallback
    if (this.MAX_SLOTS > 5) this.MAX_SLOTS = 5; // Hard limit

    this.workers = [];
    this.pendingQueue = [];
    this.lastSubmitTime = 0;

    this.isRunning = false;
    this.browser = null;
    this.page = null;
    this.profilePath = "";
  }

  log(message, type = "info") {
    if (this.master) {
      this.master.log(message, type);
    } else {
      console.log(`[Pipeline] ${message}`);
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async clipboardPaste(locator, text) {
    try {
      if (this.browser) {
        await this.browser
          .grantPermissions(["clipboard-read", "clipboard-write"])
          .catch(() => {});
      }
      await this.page.evaluate((val) => {
        return navigator.clipboard.writeText(val);
      }, text);
      await locator.focus();
      await this.page.keyboard.press("Control+A");
      await this.page.keyboard.press("Backspace");
      await this.sleep(200);
      await this.page.keyboard.press("Control+V");
      await this.sleep(300);
    } catch (e) {
      this.log(`Clipboard Paste fallback to fill(): ${e.message}`);
      await locator.fill(text);
    }
  }

  async harvestAndSaveCookies() {
    if (!this.page) return;
    try {
      this.log("Harvesting cookies for backup...");
      const allCookies = await this.page.context().cookies();
      const relevantCookies = allCookies.filter(
        (c) =>
          c.domain.includes(".google.com") || c.domain.includes("labs.google"),
      );

      if (this.io) {
        this.io.emit("veo3:update-account-cookies", {
          accountId: this.accountData.id,
          cookies: relevantCookies,
        });
      }
      this.log(`Harvested ${relevantCookies.length} relevant cookies.`);
    } catch (e) {
      this.log(`Failed to harvest cookies: ${e.message}`);
    }
  }

  async handleLoginWait() {
    if (!this.page) return;
    try {
      this.log("Navigating to Veo3 for login check...");
      await this.page.goto("https://labs.google/fx/vi/tools/flow", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await this.sleep(4000);

      let isLoggedIn = false;
      let currentUrl = await this.page.url();

      const checkLoggedIn = async () => {
        return await this.page.evaluate(() => {
          const textNodes = Array.from(
            document.querySelectorAll("div, span, button, a"),
          );
          const hasNewProject = textNodes.some((el) => {
            if (!el.textContent) return false;
            const t = el.textContent.trim().toLowerCase();
            return (
              t.includes("dự án mới") ||
              t.includes("new project") ||
              t.includes("create new project")
            );
          });
          return (
            hasNewProject ||
            !!document.querySelector(
              '[data-slate-editor="true"][role="textbox"]',
            )
          );
        });
      };

      isLoggedIn = await checkLoggedIn();

      if (this.accountData.loginMethod === "tool") {
        this.log(
          "Phương thức: Tài khoản tool. Đang kiểm tra trạng thái đăng nhập...",
        );
        if (isLoggedIn) {
          this.log("✅ Đăng nhập thành công qua profile Tài khoản tool!");
          if (
            this.accountData &&
            this.accountData.id &&
            this.master &&
            this.master.accountManager
          ) {
            this.master.accountManager.updateAccount(this.accountData.id, {
              hasProfile: true,
              status: "Active",
            });
          }
          return;
        }

        if (this.accountData.email && this.accountData.password) {
          this.log(
            "⚠️ Phát hiện session Cookies đã hết hạn. Đang tự động đăng nhập lại bằng thông tin liên kết...",
          );
        } else {
          this.log(
            "⚠️ [HỆ THỐNG] Tài khoản tool chưa đăng nhập hoặc phiên đã hết hạn!",
          );
          this.log(
            "👉 Vui lòng thực hiện đăng nhập thủ công trên cửa sổ Chrome đang mở. Bạn có 3 phút...",
          );

          for (let i = 0; i < 60; i++) {
            await this.sleep(3000);
            isLoggedIn = await checkLoggedIn();
            if (isLoggedIn) {
              this.log("✅ Phát hiện đăng nhập thủ công thành công!");
              if (
                this.accountData &&
                this.accountData.id &&
                this.master &&
                this.master.accountManager
              ) {
                this.master.accountManager.updateAccount(this.accountData.id, {
                  hasProfile: true,
                  status: "Active",
                });
              }
              return;
            }
          }

          throw new Error(
            "Hết thời gian chờ đăng nhập thủ công cho Tài khoản tool.",
          );
        }
      }

      if (
        !isLoggedIn &&
        !currentUrl.includes("accounts.google.com") &&
        !currentUrl.includes("signin")
      ) {
        let onIntroPage = false;
        try {
          onIntroPage = await this.page.evaluate(() => {
            const textNodes = Array.from(
              document.querySelectorAll("div, span, button, a"),
            );
            return textNodes.some(
              (el) =>
                el.textContent &&
                (el.textContent.trim().toLowerCase() === "tạo bằng flow" ||
                  el.textContent.trim().toLowerCase() === "create with flow"),
            );
          });
        } catch (e) {}

        if (onIntroPage) {
          this.log(
            "Intro page detected. Calculating exact coordinates to simulate human click...",
          );
          const btnCoords = await this.page.evaluate(() => {
            const candidates = Array.from(
              document.querySelectorAll(
                'a, button, div[role="button"], span, div',
              ),
            );
            for (let el of candidates) {
              const text = (el.innerText || el.textContent || "")
                .trim()
                .toLowerCase();
              if (
                text.length > 0 &&
                text.length < 40 &&
                (text.includes("tạo bằng flow") ||
                  text.includes("create with flow") ||
                  text.includes("dự án mới") ||
                  text.includes("new project"))
              ) {
                let target = el;
                while (
                  target &&
                  target.tagName !== "A" &&
                  target.tagName !== "BUTTON" &&
                  target.getAttribute("role") !== "button"
                ) {
                  if (!target.parentElement || target.tagName === "BODY") break;
                  target = target.parentElement;
                }

                target.scrollIntoView({ behavior: "instant", block: "center" });
                const r = target.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                }
              }
            }
            return null;
          });

          if (btnCoords) {
            this.log(
              `Coordinates found: X=${Math.round(btnCoords.x)}, Y=${Math.round(btnCoords.y)}. Performing stealth click...`,
            );
            await this.humanClick(this.page, btnCoords.x, btnCoords.y);
            this.log(
              "Waiting to see if redirect to login is needed, or if already logged in...",
            );
            await this.sleep(4000);

            isLoggedIn = await checkLoggedIn();
            currentUrl = await this.page.url();
          }
        }
      }

      if (
        !isLoggedIn ||
        currentUrl.includes("accounts.google.com") ||
        currentUrl.includes("AccountChooser") ||
        currentUrl.includes("signin")
      ) {
        this.log(
          "Kiểm tra trạng thái: CHƯA ĐĂNG NHẬP. Chuẩn bị đăng nhập tự động...",
        );
        if (
          this.accountData &&
          this.accountData.id &&
          this.master &&
          this.master.accountManager
        ) {
          this.master.accountManager.updateAccount(this.accountData.id, {
            status: "Login Required",
          });
        }

        const email = this.accountData.email;
        const pwd = this.accountData.password;
        const tfaSecret = this.accountData.twoFactorSecret;

        if (this.accountData.loginType === "auto" && email && pwd) {
          this.log("Auto-login initiated for " + email);
          try {
            this.log("Checking for Account Chooser / Signed Out state...");
            try {
              const accountChooserHandled = await this.page.evaluate(
                async (targetEmail) => {
                  const allElements = document.querySelectorAll("div, span");

                  for (let el of allElements) {
                    if (
                      el.textContent &&
                      el.textContent.trim().toLowerCase() ===
                        targetEmail.trim().toLowerCase()
                    ) {
                      el.click();
                      return true;
                    }
                  }

                  for (let el of allElements) {
                    if (el.textContent) {
                      const t = el.textContent.trim().toLowerCase();
                      if (
                        t === "use another account" ||
                        t === "sử dụng tài khoản khác"
                      ) {
                        el.click();
                        return false;
                      }
                    }
                  }

                  return false;
                },
                email,
              );

              if (accountChooserHandled) {
                this.log(`Found and clicked saved account: ${email}`);
                await this.sleep(2000);
              }
            } catch (e) {}

            this.log("Waiting for Email input...");
            try {
              const emailInput = this.page.locator(
                "//input[@type='email' and @id='identifierId']",
              );
              await emailInput.waitFor({ state: "visible", timeout: 15000 });
              this.log(
                "Found Email input. Chờ 4 giây để trang tải hoàn toàn...",
              );
              await this.sleep(4000);
              await emailInput.click();
              await this.sleep(500);

              this.log("Đang thực hiện paste Email...");
              await this.clipboardPaste(emailInput, email);

              const emailWaitMs =
                Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
              this.log(
                `Chờ ${Math.floor(emailWaitMs / 1000)}s sau khi nhập Email...`,
              );
              await this.sleep(emailWaitMs);

              const nextBtn = this.page.locator(
                "//div[@id='identifierNext']//button",
              );
              if (await nextBtn.isVisible()) {
                await nextBtn.click({ delay: 50 });
              } else {
                await this.page.keyboard.press("Enter");
              }

              this.log("Email submitted.");
              await this.sleep(4000);

              const errorEl = this.page.locator(
                "//div[@jsname='B34EJ' and (contains(text(), 'Couldn’t find your Google Account') or contains(text(), 'Không tìm thấy tài khoản Google'))]",
              );
              if (await errorEl.isVisible()) {
                this.log(
                  "Email không chính xác, hãy tắt và bật lại tool và nhập đúng email.",
                );
                throw new Error("Email không chính xác");
              }
            } catch (err) {
              if (err.message === "Email không chính xác") throw err;
              this.log(
                `Lỗi nhập Email: ${err.message}. Có thể đã ở trang password hoặc đã đăng nhập.`,
              );
            }

            this.log("Waiting for Password input...");
            try {
              const pwdInput = this.page
                .locator(
                  "//*[@name='Passwd'] | //input[@type='password'] | //input[@aria-label='Enter your password']",
                )
                .first();
              await pwdInput.waitFor({ state: "visible", timeout: 15000 });
              this.log(
                "Found Password input. Chờ 4 giây để trang tải hoàn toàn...",
              );
              await this.sleep(4000);
              await pwdInput.click();
              await this.sleep(500);

              this.log("Đang thực hiện paste Password...");
              await this.clipboardPaste(pwdInput, pwd);

              const pwdWaitMs =
                Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
              this.log(
                `Chờ ${Math.floor(pwdWaitMs / 1000)}s sau khi nhập Password...`,
              );
              await this.sleep(pwdWaitMs);

              const pwdNextBtn = this.page
                .locator(
                  "//div[@id='passwordNext']//button | //div[@id='identifierNext']//button",
                )
                .first();
              if (await pwdNextBtn.isVisible()) {
                await pwdNextBtn.click({ delay: 50 });
              } else {
                await this.page.keyboard.press("Enter");
              }

              this.log("Password submitted.");
              await this.sleep(5000);
            } catch (err) {
              this.log(`Lỗi nhập Password: ${err.message}`);
            }

            this.log("Checking for 2FA or success redirect...");
            let loginSuccess = false;

            try {
              await this.sleep(5000);

              const tfaSection = this.page
                .locator(
                  "//section[contains(., 'Get a verification code') or contains(., 'mã xác minh') or .//input[@id='totpPin']]",
                )
                .first();

              if (await tfaSection.isVisible()) {
                this.log("Phát hiện màn hình yêu cầu 2FA.");
                if (tfaSecret) {
                  this.log("Tài khoản có Secret 2FA. Đang gọi API lấy mã...");

                  const response = await fetch(
                    "https://tools.beeceptor.com/2FA/TOTP",
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ secret: tfaSecret }),
                    },
                  );

                  if (response.ok) {
                    const codeText = await response.text();
                    let token = codeText;
                    const match = codeText.match(/\b\d{6}\b/);
                    if (match) {
                      token = match[0];
                    }

                    this.log(`[DEBUG] Đã lấy mã OTP từ API: ${token}`);

                    const tfaInput = this.page.locator("//*[@id='totpPin']");
                    if (await tfaInput.isVisible()) {
                      await tfaInput.click();
                      await this.sleep(800);

                      this.log("Đang thực hiện paste mã 2FA...");
                      await this.clipboardPaste(tfaInput, token);

                      const tfaWaitMs =
                        Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
                      this.log(
                        `Chờ ${Math.floor(tfaWaitMs / 1000)}s sau khi điền mã 2FA...`,
                      );
                      await this.sleep(tfaWaitMs);

                      const tfaNextBtn = this.page
                        .locator(
                          "//div[@id='totpNext']//button | //div[@id='identifierNext']//button",
                        )
                        .first();
                      if (await tfaNextBtn.isVisible()) {
                        await tfaNextBtn.click({ delay: 50 });
                      } else {
                        await this.page.keyboard.press("Enter");
                      }

                      this.log("Đã nhập và gửi Form OTP 2FA.");
                      await this.sleep(5000);
                    } else {
                      this.log(
                        "Không tìm thấy ô nhập 2FA (totpPin). Bỏ qua nhập tự động...",
                      );
                    }
                  } else {
                    this.log("Lỗi khi gọi API 2FA: " + response.statusText);
                  }
                } else {
                  this.log(
                    "Tài khoản yêu cầu 2FA nhưng không cấu hình Secret. Bỏ qua nhập tự động...",
                  );
                }
              } else {
                this.log(
                  "Không thấy màn hình yêu cầu 2FA. Có thể đã đăng nhập thành công!",
                );
                loginSuccess = true;
              }
            } catch (e) {
              this.log(`Lỗi kiểm tra/điền 2FA: ${e.message}`);
            }

            // Check for security challenge (manual intervention) as a fallback
            const isChallenge = await this.page.$("#captchaimg, .g-recaptcha");
            if (isChallenge) {
              this.log(
                "❗ Phát hiện Captcha/Challenge. Bạn có 3 phút gỡ Captcha thủ công!",
              );
            }

            // Final wait for redirect back to labs
            this.log("Waiting for Labs to load post-login...");

            let postLoginLoaded = false;
            for (let w = 0; w < 60; w++) {
              try {
                const isReady = await this.page.evaluate(() => {
                  if (
                    document.querySelector(
                      '[data-slate-editor="true"][role="textbox"]',
                    )
                  )
                    return true;
                  const btn = document.querySelector(
                    "button.sc-16c4830a-1.jsIRVP.sc-a38764c7-0.fXsrxE, button:has(i.google-symbols)",
                  );
                  if (
                    btn &&
                    btn.textContent &&
                    (btn.textContent.includes("New project") ||
                      btn.textContent.includes("Dự án mới"))
                  )
                    return true;

                  const textNodes = Array.from(
                    document.querySelectorAll("div, span, button"),
                  );
                  return textNodes.some(
                    (el) =>
                      el.textContent &&
                      (el.textContent.includes("Tạo bằng Flow") ||
                        el.textContent.includes("Create with Flow") ||
                        el.textContent.includes("Dự án mới") ||
                        el.textContent.includes("New Project") ||
                        el.textContent.includes("New project")),
                  );
                });

                if (isReady) {
                  postLoginLoaded = true;
                  break;
                }
              } catch (e) {}
              await this.sleep(1000);
            }

            if (!postLoginLoaded) {
              throw new Error(
                "Timeout waiting for post-login screens (Labs / New Project)",
              );
            }

            const btnCoords = await this.page.evaluate(() => {
              const candidates = Array.from(
                document.querySelectorAll(
                  'a, button, div[role="button"], span',
                ),
              );

              for (let el of candidates) {
                const text = (el.innerText || el.textContent || "")
                  .trim()
                  .toLowerCase();
                if (text === "dự án mới" || text === "new project") {
                  let target = el;
                  while (
                    target &&
                    target.tagName !== "A" &&
                    target.tagName !== "BUTTON" &&
                    target.getAttribute("role") !== "button"
                  ) {
                    if (!target.parentElement || target.tagName === "BODY")
                      break;
                    target = target.parentElement;
                  }
                  target.scrollIntoView({
                    behavior: "instant",
                    block: "center",
                  });
                  const r = target.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {
                    return {
                      state: "new_project",
                      x: r.x + r.width / 2,
                      y: r.y + r.height / 2,
                    };
                  }
                }
              }

              for (let el of candidates) {
                const text = (el.innerText || el.textContent || "")
                  .trim()
                  .toLowerCase();
                if (text === "tạo bằng flow" || text === "create with flow") {
                  let target = el;
                  while (
                    target &&
                    target.tagName !== "A" &&
                    target.tagName !== "BUTTON" &&
                    target.getAttribute("role") !== "button"
                  ) {
                    if (!target.parentElement || target.tagName === "BODY")
                      break;
                    target = target.parentElement;
                  }
                  target.scrollIntoView({
                    behavior: "instant",
                    block: "center",
                  });
                  const r = target.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {
                    return {
                      state: "create_flow",
                      x: r.x + r.width / 2,
                      y: r.y + r.height / 2,
                    };
                  }
                }
              }
              return null;
            });

            if (btnCoords) {
              if (btnCoords.state === "create_flow") {
                this.log('Landing page: Clicking "Create with Flow"...');
                await this.humanClick(this.page, btnCoords.x, btnCoords.y);
                await this.sleep(2000);
              } else {
                this.log('Landing page: Clicking "New Project"...');
                await this.humanClick(this.page, btnCoords.x, btnCoords.y);
              }
            }

            await this.page.waitForFunction(
              '!!document.querySelector(\'[data-slate-editor="true"][role="textbox"]\')',
              { timeout: 30000, polling: 1000 },
            );

            this.log("Auto-login successful! Proceeding...");

            if (
              this.accountData &&
              this.accountData.id &&
              this.master &&
              this.master.accountManager
            ) {
              this.master.accountManager.updateAccount(this.accountData.id, {
                hasProfile: true,
                status: "Active",
              });
            }
          } catch (autoErr) {
            this.log(
              "Auto-login failed or needed manual intervention: " +
                autoErr.message,
            );
            this.log("Falling back to manual login wait (3 mins)...");
            await this.waitForManualLogin();
          }
        } else {
          this.log(
            "Login screen detected! You have 3 minutes to login manually.",
          );
          await this.waitForManualLogin();
        }
      } else {
        this.log(
          "Kiểm tra trạng thái: ĐÃ ĐĂNG NHẬP. Bỏ qua bước điền mật khẩu.",
        );
        if (
          this.accountData &&
          this.accountData.id &&
          this.master &&
          this.master.accountManager
        ) {
          this.master.accountManager.updateAccount(this.accountData.id, {
            hasProfile: true,
            status: "Active",
          });
        }

        await this.humanScroll(this.page);
      }
    } catch (e) {
      this.log(`Warning during login check: ${e.message}`);
    }
  }

  async waitForManualLogin() {
    try {
      await this.page.waitForFunction(
        '!!document.querySelector(\'[data-slate-editor="true"][role="textbox"]\')',
        { timeout: 180000, polling: 1000 },
      );
      this.log("Login successful! Proceeding...");

      if (
        this.accountData &&
        this.accountData.id &&
        this.master &&
        this.master.accountManager
      ) {
        this.master.accountManager.updateAccount(this.accountData.id, {
          hasProfile: true,
          status: "Active",
        });
      }
    } catch (timeoutErr) {
      this.log("Login wait timed out or browser was closed.");
      throw new Error("Manual login timeout or browser closed by Stop Auto.");
    }
  }

  getRand(base) {
    return base + Math.floor(Math.random() * 11) - 5;
  }

  async humanClick(page, x, y, options = {}) {
    if (!page) return;
    const button = options.button || "left";
    try {
      await page.mouse.move(x, y);

      await this.sleep(Math.floor(Math.random() * 80) + 40);

      await page.mouse.click(x, y, {
        button,
        delay: Math.floor(Math.random() * 80) + 20,
      });
    } catch (e) {
      this.log(`⚠️ Lỗi humanClick: ${e.message}`, "warning");
    }
  }

  async humanScroll(page) {
    if (!page) return;
    try {
      // Cuộn xuống sâu
      const downScrolls = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < downScrolls; i++) {
        const distance = Math.floor(Math.random() * 1200) + 600;
        await page.mouse.wheel({ deltaY: distance });
        await this.sleep(Math.floor(Math.random() * 600) + 300);
      }

      await this.sleep(Math.floor(Math.random() * 1000) + 500);

      const upScrolls = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < upScrolls; i++) {
        const distance = -(Math.floor(Math.random() * 1000) + 400);
        await page.mouse.wheel({ deltaY: distance });
        await this.sleep(Math.floor(Math.random() * 500) + 200);
      }
    } catch (e) {}
  }

  addJob(job) {
    this.pendingQueue.push(job);
    this.pendingQueue.sort((a, b) => {
      const aIsImg = a.isImageTask ? 1 : 0;
      const bIsImg = b.isImageTask ? 1 : 0;
      return bIsImg - aIsImg;
    });
    this.log(
      `Thêm Job ${job.id} vào hàng đợi. Tổng chờ: ${this.pendingQueue.length} jobs.`,
    );
  }

  async loadJobsFromExcel(filePath) {
    try {
      const xlsx = require("xlsx");
      const fs = require("fs");
      const path = require("path");
      if (!fs.existsSync(filePath)) {
        this.log(`⚠️ Không tìm thấy file Excel: ${filePath}`, "error");
        return;
      }

      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

      const excelFileName = path.basename(filePath, path.extname(filePath));

      this.log(`Đã đọc được ${data.length} dòng từ file Excel: ${filePath}`);

      for (let row of data) {
        const status = (row.STATUS || row.Status || "")
          .toString()
          .trim()
          .toLowerCase();
        if (
          status === "completed" ||
          status === "done" ||
          status === "failed"
        ) {
          continue;
        }

        const job = {
          id:
            row.JOB_ID ||
            row.id ||
            row.ID ||
            `JOB_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          prompt: row.PROMPT || row.prompt || row.Prompt || "",
          isImageTask: false,
          typeVideo: row.TYPE_VIDEO || row.typeVideo || row.TypeVideo || "T2V",
          settings: {
            videoSettings: {
              ratio: "16:9",
              count: 1,
              model: "Veo 3.1 - Lite [Lower Priority]",
            },
          },
          image1: row.IMAGE_PATH || row.image1 || null,
          image2: row.IMAGE_PATH_2 || row.image2 || null,
          image3: row.IMAGE_PATH_3 || row.image3 || null,
          projectId: excelFileName,

          excelFilePath: filePath,
          excelFileName: excelFileName,
          targetFileName: `video_${row.JOB_ID || row.id || row.ID}.mp4`,
        };

        if (job.targetFileName.includes("undefined")) {
          job.targetFileName = `video_${job.id}.mp4`;
        }

        this.addJob(job);
      }
    } catch (e) {
      this.log(`Lỗi khi đọc file Excel: ${e.message}`, "error");
    }
  }

  async initBrowser() {
    this.log("Khởi tạo trình duyệt cho Pipeline...");
    let profileBasePath = this.accountData.profilePath;
    if (
      this.accountData.loginMethod === "tool" &&
      this.accountData.toolAccount
    ) {
      const safeToolName = this.accountData.toolAccount.replace(
        /[^a-zA-Z0-9_]/g,
        "_",
      );
      if (profileBasePath) {
        profileBasePath = path.join(
          profileBasePath,
          `profile_tool_${safeToolName}`,
        );
      } else {
        const baseDir = process.env.USER_DATA_PATH || "C:\\Profiles_BAS_Flow";
        profileBasePath = path.join(baseDir, `profile_tool_${safeToolName}`);
      }
    } else if (!profileBasePath) {
      const baseDir = process.env.USER_DATA_PATH || "C:\\Profiles_BAS_Flow";
      profileBasePath = path.join(
        baseDir,
        `profile_account_${this.accountData.id}`,
      );
    }
    this.profilePath = path.join(profileBasePath, `${this.browserType}_data`);

    if (!fs.existsSync(this.profilePath)) {
      fs.mkdirSync(this.profilePath, { recursive: true });
    }

    let browserArgs = [
      "--start-maximized",
      "--disable-infobars",
      "--profile-directory=Default",
      "--disable-features=IsolateOrigins,site-per-process,AutomationControlled,CalculateNativeWinOcclusion,IntensiveWakeUpThrottling",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      "--restore-last-session=false",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-ipc-flooding-protection",
      "--disable-background-networking",
    ];

    let proxyOpt = undefined;
    if (this.assignedProxy) {
      if (this.assignedProxy.username) {
        proxyOpt = `http://${this.assignedProxy.username}:${this.assignedProxy.password}@${this.assignedProxy.ip}:${this.assignedProxy.port}`;
      } else {
        proxyOpt = `http://${this.assignedProxy.ip}:${this.assignedProxy.port}`;
      }
    }

    let isHeadless = process.env.HEADLESS_MODE === "false" ? false : true;
    if (
      this.accountData &&
      this.accountData.headless !== undefined &&
      this.accountData.headless !== null
    ) {
      isHeadless =
        String(this.accountData.headless) !== "false" &&
        this.accountData.headless !== 0 &&
        this.accountData.headless !== false;
    }

    const { launchPersistentContext } = await import("cloakbrowser");

    // ---- Tích hợp Chrome chính chủ ----
    let chromePath =
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    if (this.accountData && this.accountData.chromePath) {
      chromePath = this.accountData.chromePath;
    }
    const useRealChrome = fs.existsSync(chromePath);
    if (useRealChrome) {
      this.log(
        `✅ Phát hiện Chrome thật tại: ${chromePath}. Đang sử dụng Chrome chính chủ`,
      );
    } else {
      this.log(
        `⚠️ Không tìm thấy Chrome thật tại ${chromePath}. Đang dùng Chromium mặc định của CloakBrowser...`,
      );
    }

    this.browser = await launchPersistentContext({
      silent: true, // Tắt hiển thị log tải Chromium
      logger: false,
      userDataDir: this.profilePath,
      headless: isHeadless,
      executablePath: useRealChrome ? chromePath : undefined,
      args: browserArgs,
      viewport: null,
      proxy: proxyOpt,
      humanize: true,
      launchOptions: {
        executablePath: useRealChrome ? chromePath : undefined,
        ignoreDefaultArgs: [
          "--enable-automation",
          "--no-sandbox",
          "--disable-setuid-sandbox",
        ],
        logger: {
          isEnabled: () => false,
          log: () => {},
        },
      },
    });

    const pages = this.browser.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
    await this.page.bringToFront();

    let cookieArr = null;
    if (this.accountData && this.accountData.cookies) {
      if (Array.isArray(this.accountData.cookies)) {
        cookieArr = this.accountData.cookies;
      } else if (
        this.accountData.cookies.cookies &&
        Array.isArray(this.accountData.cookies.cookies)
      ) {
        cookieArr = this.accountData.cookies.cookies; // Hỗ trợ format Export từ Extension J2Team / EditThisCookie
      }
    }

    if (this.accountData.loginMethod !== "tool") {
      this.log(
        "Đang xóa toàn bộ cookies cũ trong trình duyệt để khởi tạo session mới...",
      );
      try {
        await this.browser.clearCookies();
        this.log("Đã làm sạch cookies thành công.");
      } catch (e) {
        this.log(`Lỗi khi dọn dẹp cookies cũ: ${e.message}`, "warning");
      }
    } else {
      this.log(
        "Phương thức Tài khoản tool: Giữ nguyên session cookies đã lưu trong profile.",
      );
    }

    if (cookieArr && cookieArr.length > 0) {
      this.log(
        `Tìm thấy ${cookieArr.length} cookies, đang thiết lập vào trình duyệt...`,
      );
      try {
        const cleanCookies = cookieArr.map((c) => {
          const { hostOnly, session, storeId, ...rest } = c;
          if (rest.sameSite === "unspecified") delete rest.sameSite;
          if (
            rest.sameSite &&
            !["Strict", "Lax", "None"].includes(rest.sameSite)
          )
            delete rest.sameSite;
          if (rest.domain && rest.domain.startsWith(".")) {
            rest.domain = rest.domain;
          }
          return rest;
        });
        await this.browser.addCookies(cleanCookies);
        this.log("Thiết lập cookies thành công!");
      } catch (e) {
        this.log(`Lỗi khi set cookies: ${e.message}`, "error");
      }
    }

    try {
      const pages = this.browser.pages();
      for (const p of pages) {
        if (p !== this.page) {
          p.close().catch(() => {});
        }
      }
    } catch (e) {}

    this.page.on("dialog", async (dialog) => await dialog.accept());

    await this.handleLoginWait();
    await this.harvestAndSaveCookies();

    this.log("Trình duyệt Pipeline đã sẵn sàng.");
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.initBrowser();
    } catch (e) {
      this.log(`Lỗi khởi tạo trình duyệt Pipeline: ${e.message}`, "error");
      this.isRunning = false;
      return;
    }

    this.log(`Bắt đầu vòng lặp Pipeline (Max Slots: ${this.MAX_SLOTS})...`);
    this.runLoop();
  }

  async stop() {
    this.isRunning = false;
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {}
    }
  }

  async runLoop() {
    this.isRunning = true;
    this.log(`Bắt đầu vòng lặp Pipeline (Max Luồng: ${this.MAX_SLOTS})...`);

    while (this.isRunning) {
      try {
        while (this.workers.length < this.MAX_SLOTS && this.isRunning) {
          const isFirst = this.workers.length === 0;

          const newPage = isFirst ? this.page : await this.browser.newPage();
          if (!isFirst) {
            await newPage.bringToFront();

            await this.sleep(2000);
          }
          this.workers.push({
            id: this.workers.length + 1,
            page: newPage,
            projectUrl: null,
            currentJob: null,
            state: "idle",
            failCount: 0,
            startTime: 0,
            percentSeen: false,
            waitingWithoutPercent: 0,
            hasReloaded: false,
            viewedVideoCount: 0,
          });
          this.log(`Đã khởi tạo Worker (Tab) số ${this.workers.length}.`);
        }

        for (let worker of this.workers) {
          if (worker.state === "idle" && this.pendingQueue.length > 0) {
            const nextJob = this.pendingQueue.shift();
            worker.currentJob = nextJob;
            worker.state = "submitting";
            worker.startTime = Date.now();
            worker.percentSeen = false;
            worker.waitingWithoutPercent = 0;
            worker.hasReloaded = false;
            worker.viewedVideoCount = 0;

            this.log(`[Worker ${worker.id}] Nạp Job ${nextJob.id}...`);

            this.processWorkerSubmit(worker).catch(async (e) => {
              this.log(
                `[Worker ${worker.id}] Lỗi submit Job ${nextJob.id}: ${e.message}`,
                "error",
              );

              nextJob.retries = (nextJob.retries || 0) + 1;
              if (nextJob.retries === 1) {
                this.log(
                  `[Worker ${worker.id}] 🔄 Job ${nextJob.id} bị lỗi lần đầu. Tự động đẩy lại vào đầu hàng đợi để thử lại ngay lập tức...`,
                );
                this.pendingQueue.unshift(nextJob);
              } else {
                this.log(
                  `[Worker ${worker.id}] ❌ Job ${nextJob.id} đã thất bại lần thứ 2. Cập nhật trạng thái Thất bại lên server.`,
                );
                if (this.master) {
                  this.master.updateJobStatus(nextJob, "Failed", e.message);
                }
              }
              this.master.activeJobs.delete(nextJob.id);

              worker.failCount++;
              if (worker.failCount >= 3) {
                this.log(
                  `[Worker ${worker.id}] Lỗi liên tiếp 3 lần. Đóng tab này và GIẢM 1 luồng xử lý trong 3 phút...`,
                  "error",
                );
                await worker.page.close().catch(() => {});
                this.workers = this.workers.filter((w) => w.id !== worker.id);
                this.MAX_SLOTS--;

                setTimeout(() => {
                  this.MAX_SLOTS++;
                  this.log(
                    `[HỆ THỐNG] 🕒 Đã hết 3 phút giảm luồng. Tự động khôi phục lại luồng xử lý. Số luồng tối đa hiện tại: ${this.MAX_SLOTS}`,
                  );
                }, 180000);
              } else {
                worker.state = "idle";
                worker.currentJob = null;
              }
            });
          }
        }

        for (let worker of this.workers) {
          if (worker.state === "polling") {
            if (Date.now() - worker.startTime > 10 * 60 * 1000) {
              this.log(
                `[Worker ${worker.id}] Timeout: Job ${worker.currentJob.id} bị treo hơn 10 phút.`,
              );

              worker.currentJob.retries = (worker.currentJob.retries || 0) + 1;
              if (worker.currentJob.retries === 1) {
                this.log(
                  `[Worker ${worker.id}] 🔄 Job ${worker.currentJob.id} bị timeout lần đầu. Tự động đẩy lại vào đầu hàng đợi để thử lại ngay lập tức...`,
                );
                this.pendingQueue.unshift(worker.currentJob);
              } else {
                this.log(
                  `[Worker ${worker.id}] ❌ Job ${worker.currentJob.id} đã bị timeout lần thứ 2. Cập nhật trạng thái Thất bại lên server.`,
                );
                this.master.updateJobStatus(
                  worker.currentJob,
                  "Failed",
                  "Timeout 10 phút không có kết quả",
                );
              }
              this.master.activeJobs.delete(worker.currentJob.id);
              worker.state = "idle";
              worker.currentJob = null;
              continue;
            }

            try {
              const isDone = await this.checkJobStatus(worker);
              if (isDone) {
                this.log(
                  `[Worker ${worker.id}] Job ${worker.currentJob.id} đã hoàn tất. Worker trở lại trạng thái rảnh.`,
                );
                this.master.activeJobs.delete(worker.currentJob.id);
                worker.state = "idle";
                worker.currentJob = null;
              }
            } catch (e) {
              this.log(
                `[Worker ${worker.id}] Lỗi khi kiểm tra trạng thái Job: ${e.message}`,
                "error",
              );

              worker.currentJob.retries = (worker.currentJob.retries || 0) + 1;
              if (worker.currentJob.retries === 1) {
                this.log(
                  `[Worker ${worker.id}] 🔄 Job ${worker.currentJob.id} bị lỗi kiểm tra lần đầu. Tự động đẩy lại vào đầu hàng đợi để thử lại ngay lập tức...`,
                );
                this.pendingQueue.unshift(worker.currentJob);
              } else {
                this.log(
                  `[Worker ${worker.id}] ❌ Job ${worker.currentJob.id} lỗi kiểm tra lần thứ 2. Cập nhật trạng thái Thất bại lên server.`,
                );
                this.master.updateJobStatus(
                  worker.currentJob,
                  "Failed",
                  e.message,
                );
              }
              this.master.activeJobs.delete(worker.currentJob.id);

              worker.failCount++;
              if (worker.failCount >= 3) {
                this.log(
                  `[Worker ${worker.id}] Lỗi liên tiếp 3 lần. Đóng tab này và GIẢM 1 luồng xử lý trong 3 phút...`,
                  "error",
                );
                await worker.page.close().catch(() => {});
                this.workers = this.workers.filter((w) => w.id !== worker.id);
                this.MAX_SLOTS--;

                setTimeout(() => {
                  this.MAX_SLOTS++;
                  this.log(
                    `[HỆ THỐNG] 🕒 Đã hết 3 phút giảm luồng. Tự động khôi phục lại luồng xử lý. Số luồng tối đa hiện tại: ${this.MAX_SLOTS}`,
                  );
                }, 180000);
              } else {
                worker.state = "idle";
                worker.currentJob = null;
              }
            }
          }
        }

        const hasActiveJobs = this.workers.some((w) => w.state !== "idle");
        if (
          this.pendingQueue.length === 0 &&
          !hasActiveJobs &&
          this.workers.length > 0
        ) {
          this.log(
            "🎉 [HỆ THỐNG] Tất cả các Job trong hàng đợi đã được xử lý hoàn tất!",
          );
          this.log(
            "👉 Tiến trình tự động kết thúc. Đang đóng trình duyệt Chrome...",
          );
          this.isRunning = false;
          await this.stop();
          if (this.io) {
            this.io.emit("veo3:pipeline-finished");
          }
          await this.sleep(1000);
          process.exit(0);
        }
      } catch (fatalError) {
        this.log(`Fatal Pipeline Error: ${fatalError.message}`, "error");
      }

      await this.sleep(3000);
    }
  }

  async processWorkerSubmit(worker) {
    try {
      const projectUrl = await this.submitNewJob(worker);
      if (projectUrl) {
        worker.projectUrl = projectUrl;
        worker.state = "polling";
        worker.startTime = Date.now();
      } else {
        throw new Error("Không lấy được Project URL sau khi submit");
      }
    } catch (e) {
      throw e;
    }
  }

  async findNodeByTextExact(page, matchesArr) {
    if (!page) return null;
    try {
      return await page.evaluate((texts) => {
        const lowerTexts = texts.map((t) => t.toLowerCase());

        // Comprehensive clickable selector including Radix UI roles
        const CLICKABLE =
          'button, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="option"], li, a, label, span, div.button';

        let textMatches = [];

        const isVisible = (el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.height > 0 &&
            window.getComputedStyle(el).visibility !== "hidden"
          );
        };

        for (const el of document.querySelectorAll("*")) {
          if (!isVisible(el) && el.tagName !== "BODY") continue;

          let directText = "";
          for (let i = 0; i < el.childNodes.length; i++) {
            if (el.childNodes[i].nodeType === Node.TEXT_NODE) {
              directText += el.childNodes[i].textContent;
            }
          }
          directText = directText.trim().toLowerCase();

          if (directText && lowerTexts.includes(directText)) {
            textMatches.push(el);
          }
        }

        if (textMatches.length === 0) {
          for (const icon of document.querySelectorAll(
            'i.google-symbols, i[class*="google-symbols"]',
          )) {
            if (!isVisible(icon)) continue;
            const iconText = (icon.textContent || "").trim().toLowerCase();
            if (iconText && lowerTexts.includes(iconText)) {
              textMatches.push(icon);
            }
          }
        }

        if (textMatches.length === 0) {
          const all = Array.from(document.querySelectorAll(CLICKABLE));
          for (const el of all) {
            if (!isVisible(el)) continue;
            const t = (el.innerText || "").trim().toLowerCase();
            if (t && lowerTexts.includes(t)) {
              textMatches.push(el);
            }
          }
        }

        if (textMatches.length > 0) {
          for (let i = textMatches.length - 1; i >= 0; i--) {
            const match = textMatches[i];
            const clickable = match.closest(CLICKABLE) || match;
            const r = clickable.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }
          }
        }
        return null;
      }, matchesArr);
    } catch (e) {
      console.error("Lỗi findNodeByTextExact:", e);
      return null;
    }
  }

  async findNodeBySelector(page, selector) {
    if (!page) return null;
    try {
      return await page.evaluate((sel) => {
        const elements = document.querySelectorAll(sel);

        for (let i = elements.length - 1; i >= 0; i--) {
          let el = elements[i];
          if (el) {
            const r = el.getBoundingClientRect();
            if (
              r.width > 0 &&
              r.height > 0 &&
              window.getComputedStyle(el).visibility !== "hidden"
            ) {
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }
          }
        }
        return null;
      }, selector);
    } catch (e) {
      return null;
    }
  }
  async clickModelDropdownWithVerify(
    page,
    clickCoord,
    coords,
    triggerKey,
    modelName,
  ) {
    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const menuCountBefore = await page
        .evaluate(() => {
          let count = 0;
          const menus = document.querySelectorAll(
            '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]',
          );
          for (const m of menus) {
            const r = m.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) count++;
          }
          return count;
        })
        .catch(() => 0);

      await clickCoord(coords.model, triggerKey);
      await this.sleep(800);

      const menuCountAfter = await page
        .evaluate(() => {
          let count = 0;
          const menus = document.querySelectorAll(
            '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]',
          );
          for (const m of menus) {
            const r = m.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) count++;
          }
          return count;
        })
        .catch(() => 0);

      const newMenuOpened = menuCountAfter > menuCountBefore;

      if (newMenuOpened) {
        this.log(
          `Model dropdown verified open (attempt ${attempt + 1}). Menus: ${menuCountBefore} → ${menuCountAfter}`,
        );
        break;
      } else if (attempt < MAX_RETRIES) {
        this.log(
          `⚠️ Model dropdown not detected (menus: ${menuCountBefore} → ${menuCountAfter}). Retrying (${attempt + 1}/${MAX_RETRIES})...`,
        );

        const editorCoords = await this.findNodeBySelector(
          page,
          '[data-slate-editor="true"]',
        );
        if (editorCoords) {
          await this.humanClick(page, editorCoords.x, editorCoords.y);
        } else {
          await page.click('[data-slate-editor="true"]');
        }
        await this.sleep(500);
      } else {
        this.log(
          `⚠️ Model dropdown failed to open after ${MAX_RETRIES + 1} attempts. Proceeding anyway...`,
        );
      }
    }

    await clickCoord(coords.model, modelName);
    await this.sleep(600);
  }
  async selectImagesFromGallery(page, rawImagePaths, job = null) {
    if (!rawImagePaths || !Array.isArray(rawImagePaths)) {
      return true;
    }

    const veo3Ids = [];
    for (let p of rawImagePaths) {
      if (p && typeof p === "string") {
        if (p.startsWith("{")) {
          try {
            const parsed = JSON.parse(p);
            if (parsed.veo3Id) {
              veo3Ids.push(parsed.veo3Id);
            } else {
              throw new Error(
                "Thiếu veo3Id trong dữ liệu ảnh. Vui lòng tạo lại nhân vật bằng công cụ AI để đồng bộ ID.",
              );
            }
          } catch (e) {
            if (e.message.includes("veo3Id")) throw e;
          }
        } else if (p.trim()) {
          throw new Error(
            "Đường dẫn ảnh không hợp lệ (Không phải dữ liệu JSON chứa veo3Id).",
          );
        }
      }
    }

    if (veo3Ids.length === 0) return true;

    this.log(
      `Bắt đầu chọn ${veo3Ids.length} ảnh nhân vật từ Thư viện (Gallery) cho mode IN2V/I2V...`,
    );

    this.log("Chuyển sang luồng giả lập click nút (+)...");

    let plusBtnCoords = null;
    for (let wait = 0; wait < 15; wait++) {
      plusBtnCoords = await page.evaluate(() => {
        const getCenter = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0)
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          return null;
        };

        const editor = document.querySelector(
          '.ql-editor, [data-slate-editor="true"], textarea, [contenteditable="true"]',
        );
        if (!editor) return null;

        let parent = editor.parentElement;
        let validBtns = [];
        for (let i = 0; i < 5; i++) {
          if (!parent) break;
          // Tìm tất cả các button trong parent này
          const btns = Array.from(
            parent.querySelectorAll(
              'button, [role="button"], div[role="button"]',
            ),
          );
          validBtns = btns.filter((b) => {
            // Phải hiển thị được
            const r = b.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;

            if (b === editor || b.contains(editor)) return false;

            return true;
          });

          if (validBtns.length > 0) {
            break;
          }
          parent = parent.parentElement;
        }

        if (validBtns.length === 0) return null;

        const editorRect = editor.getBoundingClientRect();
        let bestBtn = null;
        let minDistance = 9999;

        for (let b of validBtns) {
          const hasDialogAria = b.getAttribute("aria-haspopup") === "dialog";

          const hasGooglePlusIcon = Array.from(
            b.querySelectorAll("i, span, div"),
          ).some((el) => {
            if (
              el.classList &&
              Array.from(el.classList).some((c) => c.includes("google-symbols"))
            ) {
              const txt = (el.textContent || "").trim();
              return ["add", "add_2", "attach_file", "upload"].includes(txt);
            }
            return false;
          });

          const hiddenSpan = b.querySelector('span[style*="absolute"]');
          const isCreateText =
            hiddenSpan &&
            ["tạo", "create"].includes(
              (hiddenSpan.textContent || "").trim().toLowerCase(),
            );

          if (
            (hasDialogAria && hasGooglePlusIcon) ||
            (hasGooglePlusIcon && isCreateText)
          ) {
            bestBtn = b;
            break;
          }

          const aria = (b.getAttribute("aria-label") || "").toLowerCase();
          if (
            aria.includes("tải lên") ||
            aria.includes("upload") ||
            aria.includes("đính kèm")
          ) {
            bestBtn = b;
            break;
          }
        }

        if (bestBtn) return getCenter(bestBtn);

        const explicitUploadBtn = validBtns.find((b) => {
          const aria = (b.getAttribute("aria-label") || "").toLowerCase();
          return (
            aria.includes("tải lên") ||
            aria.includes("upload") ||
            aria.includes("attach")
          );
        });

        if (explicitUploadBtn) return getCenter(explicitUploadBtn);

        return null;
      });

      if (plusBtnCoords) break;
      this.log(`Chưa thấy nút (+), đợi thêm 1s... (${wait + 1}/15)`);
      await this.sleep(1000);
    }

    if (!plusBtnCoords) {
      throw new Error(
        "TIMEOUT: Không tìm thấy nút (+) để đính kèm ảnh/giọng nói sau 15 giây. Dừng Job!",
      );
    }

    let selectSuccess = false;

    if (plusBtnCoords) {
      this.log(
        `Tìm thấy nút Thêm (+). Đang click tại tọa độ ${plusBtnCoords.x}, ${plusBtnCoords.y}`,
      );
      await this.humanClick(page, plusBtnCoords.x, plusBtnCoords.y);
      await this.sleep(1500);

      if (veo3Ids.length > 0) {
        this.log(
          `Tiến hành chọn ${veo3Ids.length} nhân vật từ Gallery bằng ID...`,
        );
        // Chờ hộp thoại hiện lên
        await page
          .waitForSelector('div[role="dialog"]', { timeout: 10000 })
          .catch(() => {});

        // Ensure Image Tab is active
        const clickedImageTab = await page.evaluate(() => {
          const tw = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
          );
          let node;
          while ((node = tw.nextNode())) {
            const t = node.nodeValue.trim().toLowerCase();
            if (t === "hình ảnh" || t === "image" || t === "images") {
              const btn = node.parentElement.closest('button, div[role="tab"]');
              if (btn && btn.getAttribute("aria-selected") !== "true") {
                btn.click();
                return true;
              }
            }
          }
          return false;
        });
        if (clickedImageTab) await this.sleep(1000);

        const changeGallerySort = async (mode) => {
          return await page.evaluate(async (m) => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

            // Sử dụng TreeWalker để tìm chính xác chữ "Gần đây", "Mới nhất", v.v.
            let targetSortBtn = null;
            const tw = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
            );
            let node;
            while ((node = tw.nextNode())) {
              const t = node.nodeValue.trim().toLowerCase();
              if (
                t === "gần đây" ||
                t === "mới nhất" ||
                t === "cũ nhất" ||
                t === "dùng nhiều nhất"
              ) {
                // Tìm thẻ cha có thể click được
                targetSortBtn = node.parentElement.closest(
                  'button, div[role="button"], div[role="combobox"], div[aria-haspopup], span',
                );
                if (targetSortBtn) break;
              }
            }

            if (!targetSortBtn) return false;

            // Nếu nút hiện tại đang hiển thị đúng chế độ mong muốn -> bỏ qua
            if (
              (targetSortBtn.innerText || targetSortBtn.textContent || "")
                .trim()
                .toLowerCase() === m.toLowerCase()
            ) {
              return true;
            }

            // Mở menu
            targetSortBtn.click();
            await sleep(800);

            // Tìm option mong muốn trong menu bằng Text Node
            const optTw = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
            );
            let optNode;
            while ((optNode = optTw.nextNode())) {
              if (optNode.nodeValue.trim().toLowerCase() === m.toLowerCase()) {
                // Kiểm tra xem Text này có nằm trong menu xổ ra không (role="option" hoặc li)
                const optEl = optNode.parentElement.closest(
                  'div[role="option"], li[role="option"], li, span',
                );
                if (
                  optEl &&
                  optEl !== targetSortBtn &&
                  optEl.clientHeight > 0
                ) {
                  optEl.click();
                  await sleep(2000);
                  return true;
                }
              }
            }

            document.body.click();
            return false;
          }, mode);
        };

        const searchWithScroll = async (vid) => {
          return await page.evaluate(async (id) => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

            const findAndClick = () => {
              const imgs = Array.from(
                document.querySelectorAll(
                  'div[role="dialog"] img, div[data-radix-popper-content-wrapper] img',
                ),
              );
              for (const img of imgs) {
                if (img.src && img.src.includes(id)) {
                  img.click();
                  return true;
                }
              }
              return false;
            };

            if (findAndClick()) return true;

            let attempts = 0;
            const maxAttempts = 20;

            while (attempts < maxAttempts) {
              const imgs = Array.from(
                document.querySelectorAll(
                  'div[role="dialog"] img, div[data-radix-popper-content-wrapper] img',
                ),
              );
              if (imgs.length === 0) break;

              // Cuộn ảnh cuối cùng để kích hoạt virtualized lists / lazy load
              const lastImg = imgs[imgs.length - 1];
              lastImg.scrollIntoView({ behavior: "smooth", block: "end" });
              await sleep(500);

              // Cuộn cưỡng bức TẤT CẢ các container có thanh cuộn (shotgun approach)
              const dialog =
                document.querySelector('div[role="dialog"]') ||
                document.querySelector(
                  "div[data-radix-popper-content-wrapper]",
                ) ||
                document.body;
              const els = dialog.querySelectorAll("*");
              let didScroll = false;
              for (let el of els) {
                // Nếu có thể cuộn được (scrollbar hiện hữu)
                if (el.scrollHeight > el.clientHeight + 10) {
                  el.scrollBy(0, 1500);
                  didScroll = true;
                }
              }
              if (!didScroll) {
                window.scrollBy(0, 1500);
              }

              await sleep(1000);

              if (findAndClick()) return true;

              attempts++;
            }
            return false;
          }, vid);
        };

        // For each ID, find the img and click it
        for (const vid of veo3Ids) {
          this.log(
            `Đang tìm kiếm ảnh ID: ${vid} trong Gallery (có thể tự động cuộn)...`,
          );

          let clicked = await searchWithScroll(vid);

          if (!clicked) {
            this.log(
              `Không thấy ảnh ID: ${vid}. Đang thử đổi sắp xếp sang "Mới nhất"...`,
            );
            await changeGallerySort("mới nhất");
            clicked = await searchWithScroll(vid);
          }
          if (!clicked) {
            this.log(
              `Không thấy ảnh ID: ${vid}. Đang thử đổi sắp xếp sang "Cũ nhất"...`,
            );
            await changeGallerySort("cũ nhất");
            clicked = await searchWithScroll(vid);
          }
          if (clicked) {
            this.log(`Đã click chọn ảnh ID: ${vid}`);
            await this.sleep(500);
            selectSuccess = true;
          } else {
            this.log(`⚠️ Không tìm thấy ảnh ID: ${vid} trong Gallery.`);
            throw new Error(
              `Không tìm thấy ảnh nhân vật (ID: ${vid}) trong Thư viện (Gallery) của Google Veo3. Vui lòng tạo lại ảnh.`,
            );
          }
        }
      } else {
        this.log(
          "Không có ảnh nguyên liệu cần chọn từ thư viện, bỏ qua bước chọn ảnh.",
        );
        selectSuccess = true;
      }
    } else {
      this.log("Không tìm thấy nút (+) để đính kèm nguyên liệu! Bỏ qua...");
      return false;
    }

    if (selectSuccess && veo3Ids.length > 0) {
      this.log(
        `Đã chọn ảnh thành công. Bắt đầu chờ đính kèm hoàn tất (Tối đa 15s)...`,
      );

      const uploadWaitStart = Date.now();
      let looksDone = false;
      let errorMsg = null;

      while (Date.now() - uploadWaitStart < 40000) {
        const checkRes = await page.evaluate(() => {
          // 1. Kiểm tra LỖI CHÍNH SÁCH / BẢN QUYỀN (Snackbar, Alert, Dialog)
          const alerts = Array.from(
            document.querySelectorAll(
              '[role="alert"], [class*="snackbar"], snack-bar, [role="alertdialog"], .msg, .error',
            ),
          );
          for (let a of alerts) {
            const t = (a.innerText || "").toLowerCase();
            if (a.offsetParent !== null && t.length > 5) {
              // Visible alert
              if (
                t.includes("vi phạm") ||
                t.includes("chính sách") ||
                t.includes("policy") ||
                t.includes("cấm") ||
                t.includes("không thể tải lên") ||
                t.includes("could not upload") ||
                t.includes("unsupported") ||
                t.includes("error") ||
                t.includes("lỗi")
              ) {
                return { status: "error", message: a.innerText.trim() };
              }
            }
          }

          // 2. Tìm khu vực upload của khung Editor
          const editorContainer =
            document
              .querySelector('[data-slate-editor="true"][role="textbox"]')
              ?.closest('div[style*="border-radius"]') ||
            document.querySelector('[data-slate-editor="true"][role="textbox"]')
              ?.parentElement?.parentElement ||
            document.body;

          // 3. Đang Upload %?
          const texts = Array.from(
            editorContainer.querySelectorAll("span, div, p"),
          );
          const hasProgress = texts.some((el) => {
            const t = el.innerText.trim();
            return (
              t.endsWith("%") &&
              t.length > 1 &&
              t.length <= 4 &&
              !isNaN(parseInt(t))
            );
          });

          if (hasProgress) return { status: "uploading" };

          // 4. Có Thumbnail chip (Ảnh đúng chỗ) chưa?
          const mediaEls = Array.from(
            editorContainer.querySelectorAll("img, canvas"),
          );
          const validThumbnails = mediaEls.filter((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.width > 20 &&
              r.height > 20 &&
              el.offsetParent !== null &&
              !el.src.includes("avatar")
            );
          });

          if (validThumbnails.length > 0) return { status: "ready" };

          return { status: "waiting" };
        });

        if (checkRes.status === "error") {
          errorMsg = checkRes.message;
          break; // Thoát đợi luôn
        } else if (checkRes.status === "ready") {
          looksDone = true;
          this.log("Ảnh nhân vật đã xuất hiện trên khung lệnh!");
          break;
        } else if (checkRes.status === "uploading") {
          // Keep waiting (silently)
        }

        // Nếu bị báo lỗi vi phạm nhưng dưới dạng tooltips / icon chấm đỏ sát bức ảnh...
        // thì có thể chờ hết 40 giây. Cái đó bắt sau nếu gặp. Hiện tại bắt text alert.
        await this.sleep(1500);
      }

      if (errorMsg) {
        this.log(`⚠️ PHÁT HIỆN LỖI CHÍNH SÁCH / UPLOAD TỪ UI: "${errorMsg}"`);
        return false;
      }

      if (!looksDone) {
        this.log(
          "⚠️ Hết timeout chờ ảnh đính kèm. Thumbnail không xuất hiện. Tiếp tục luồng xử lý...",
        );
      } else {
        this.log(
          "Đang chờ thêm 5 giây để Google load hoàn tất file ảnh trước khi cho phép bấm Submit...",
        );
        await this.sleep(5000); // Buffer for UI to fully settle
      }
    }

    return selectSuccess;
  }

  async uploadLocalImagesIN2V(page, imagesArray) {
    if (!imagesArray || imagesArray.length === 0) return true;
    this.log(`Bắt đầu quy trình upload ảnh từ Local cho IN2V...`);

    // Extract all paths
    let paths = [];
    for (let imgObj of imagesArray) {
      for (let key in imgObj) {
        const cleanPath = imgObj[key]
          ? imgObj[key]
              .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, "")
              .replace(/^["']|["']$/g, "")
              .trim()
          : null;
        if (cleanPath && require("fs").existsSync(cleanPath)) {
          paths.push(cleanPath);
        }
      }
    }

    if (paths.length === 0) {
      this.log(`⚠️ Không tìm thấy file ảnh hợp lệ nào trong Local để upload.`);
      return false;
    }

    // Giai đoạn 0: Kiểm tra ảnh có sẵn trong thư viện
    this.log(`Kiểm tra các ảnh đã có sẵn trong thư viện...`);
    let pathsToUpload = [];
    try {
      let tabCoords = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
        for (let tab of tabs) {
          const text = (tab.innerText || tab.textContent || "").toLowerCase();
          if (text.includes("images") || text.includes("hình ảnh") || text.includes("ảnh")) {
            const r = tab.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }
          }
        }
        return null;
      });

      if (!tabCoords) {
         let clickedAdd = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll("button")).reverse();
            for (let btn of buttons) {
              const icon = btn.querySelector('i.google-symbols, i[class*="google-symbols"]');
              if (icon && icon.textContent.trim() === "add_2") {
                const r = btn.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  btn.click();
                  return true;
                }
              }
            }
            return false;
         });
         if (clickedAdd) {
             await this.sleep(1500);
             tabCoords = await page.evaluate(() => {
                const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
                for (let tab of tabs) {
                  const text = (tab.innerText || tab.textContent || "").toLowerCase();
                  if (text.includes("images") || text.includes("hình ảnh") || text.includes("ảnh")) {
                    const r = tab.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                    }
                  }
                }
                return null;
             });
         }
      }

      if (tabCoords) {
         await this.humanClick(page, tabCoords.x, tabCoords.y);
         await this.sleep(2000);
         const existingFiles = await page.evaluate(() => {
            const divs = Array.from(document.querySelectorAll('div'));
            const names = [];
            for (let div of divs) {
              if (div.children.length === 0) {
                 const text = (div.innerText || div.textContent || "").trim();
                 if (text) names.push(text);
              }
            }
            return names;
         });
         
         for (let path of paths) {
            const filename = path.split('\\').pop().split('/').pop();
            if (existingFiles.includes(filename)) {
                this.log(`✅ Ảnh '${filename}' đã có sẵn trong thư viện. Bỏ qua tải lên.`);
            } else {
                pathsToUpload.push(path);
            }
         }
      } else {
         pathsToUpload = [...paths];
      }
    } catch (e) {
      pathsToUpload = [...paths];
    }

    for (let i = 0; i < pathsToUpload.length; i++) {
      const path = pathsToUpload[i];
      this.log(
        `Đang tìm nút Add Image (add_2) để upload ảnh ${i + 1}/${pathsToUpload.length}...`,
      );

      // Helper inside evaluate to find upload button
      const checkUploadMedia = () => {
        const elements = Array.from(document.querySelectorAll("button, div, span, li"));
        for (let el of elements) {
          if (el.getAttribute("role") === "tab") continue;
          const text = (el.innerText || el.textContent || "").toLowerCase();
          if (
            (text.includes("upload media") ||
             text.includes("upload image") ||
             text.includes("tải nội dung nghe nhìn") ||
             text.includes("tải hình ảnh")) && text.length < 60
          ) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }
          }
        }
        return null;
      };

      // Step 1: Check if Upload media is ALREADY visible
      let btnCoords = await page.evaluate(checkUploadMedia);

      if (!btnCoords) {
        // Nếu bị ẩn, click add_2 để mở menu
        let clickedAdd = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button")).reverse();
          for (let btn of buttons) {
            const icon = btn.querySelector(
              'i.google-symbols, i[class*="google-symbols"]',
            );
            if (icon && icon.textContent.trim() === "add_2") {
              const r = btn.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                btn.click();
                return true;
              }
            }
          }
          return false;
        });

        if (clickedAdd) {
          await this.sleep(1500);
          btnCoords = await page.evaluate(checkUploadMedia);
        } else {
          this.log(`⚠️ Lỗi: Không tìm thấy nút Add Image (add_2). Bỏ qua ảnh này.`);
          continue;
        }
      }

      if (!btnCoords) {
         this.log(`⚠️ Lỗi: Không tìm thấy nút Upload trên màn hình (đã thử mở menu). Bỏ qua ảnh này.`);
         continue;
      }

      // Step 2: Click Upload Image and handle FileChooser
      this.log(`Đang mở File Chooser để chọn file...`);
      try {

        let fileChooser = null;
        if (btnCoords) {
          try {
            const [fc] = await Promise.all([
              page.waitForEvent("filechooser", { timeout: 8000 }),
              this.humanClick(page, btnCoords.x, btnCoords.y)
            ]);
            fileChooser = fc;
          } catch (e) {}
        }

        if (fileChooser) {
          await fileChooser.setFiles([path]);
          this.log(`✅ Đã đính kèm ảnh: ${path}. Đang chờ Google xử lý...`);

          let uploadDone = false;
          let waitChecks = 0;
          // Initial wait so the UI can register the file
          await this.sleep(1000);

          let seenPercent = false;
          while (!uploadDone && waitChecks < 40) {
            // Max 60s
            const state = await page.evaluate(() => {
              const allNodes = Array.from(
                document.querySelectorAll("div, span, p"),
              );
              const hasPercent = allNodes.some((el) => {
                const t = (el.innerText || el.textContent || "").trim();
                // Match anything ending with % and is a number, e.g. "45%"
                return (
                  t.endsWith("%") &&
                  t.length > 1 &&
                  t.length <= 4 &&
                  !isNaN(parseInt(t.replace("%", "")))
                );
              });
              return { hasPercent };
            });

            if (state.hasPercent) {
              seenPercent = true;
              // Vẫn đang có %, tiếp tục đợi
            } else {
              if (seenPercent) {
                // Đã từng thấy % và giờ mất % => upload xong
                uploadDone = true;
              } else if (waitChecks > 3) {
                // Không thấy % xuất hiện sau ~6 giây, có thể file upload quá nhanh nên không kịp thấy %
                uploadDone = true;
              }
            }

            if (!uploadDone) {
              waitChecks++;
              // Quay tròn chuột (humanize) trong lúc chờ
              const cx = 500 + Math.random() * 200;
              const cy = 300 + Math.random() * 200;
              const r = 20 + Math.random() * 30;
              const angle = (waitChecks * 0.5) % (Math.PI * 2);
              await page.mouse
                .move(cx + r * Math.cos(angle), cy + r * Math.sin(angle))
                .catch(() => {});
              await this.sleep(1500);
            }
          }

          if (uploadDone) {
            this.log(
              `✅ Ảnh ${i + 1} đã upload hoàn tất (dựa trên trạng thái hiển thị %).`,
            );
          } else {
            this.log(
              `⚠️ Hết thời gian chờ xử lý ảnh ${i + 1}. Vẫn tiếp tục thực hiện.`,
            );
          }
        }
      } catch (err) {
        this.log(
          `⚠️ Lỗi: Không mở được File Chooser cho ảnh thứ ${i + 1}. Error: ${err.message}`,
        );
      }
    }

    // Giai đoạn 2: Sau khi upload xong, đính kèm ảnh vào prompt
    this.log(`Tất cả ảnh đã tải lên. Đang đính kèm từng ảnh vào prompt...`);
    try {
        for (let i = 0; i < paths.length; i++) {
          const path = paths[i];
          const filename = path.split('\\').pop().split('/').pop();
          this.log(`Đang xử lý ảnh: ${filename}...`);
          
          // 1. Kiểm tra xem tab Images có đang hiển thị không (menu có đang mở không)
          let tabCoords = await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
            for (let tab of tabs) {
              const text = (tab.innerText || tab.textContent || "").toLowerCase();
              if (text.includes("images") || text.includes("hình ảnh") || text.includes("ảnh")) {
                const r = tab.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                }
              }
            }
            return null;
          });

          // Nếu menu đang đóng, bấm add_2 để mở lại
          if (!tabCoords) {
             this.log(`Menu đang đóng, mở lại bằng nút add_2...`);
             let clickedAdd = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll("button")).reverse();
                for (let btn of buttons) {
                  const icon = btn.querySelector('i.google-symbols, i[class*="google-symbols"]');
                  if (icon && icon.textContent.trim() === "add_2") {
                    const r = btn.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                      btn.click();
                      return true;
                    }
                  }
                }
                return false;
             });
             
             if (clickedAdd) {
                 await this.sleep(1500);
                 // Tính lại tọa độ tab Images
                 tabCoords = await page.evaluate(() => {
                    const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
                    for (let tab of tabs) {
                      const text = (tab.innerText || tab.textContent || "").toLowerCase();
                      if (text.includes("images") || text.includes("hình ảnh") || text.includes("ảnh")) {
                        const r = tab.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                        }
                      }
                    }
                    return null;
                 });
             }
          }

          if (tabCoords) {
             // Bấm vào tab Images
             await this.humanClick(page, tabCoords.x, tabCoords.y);
             await this.sleep(1500);
             
             // Tìm và bấm vào filename
             let imgCoords = await page.evaluate((fname) => {
                const divs = Array.from(document.querySelectorAll('div'));
                for (let div of divs) {
                  if (div.children.length === 0) {
                     const text = (div.innerText || div.textContent || "").trim();
                     if (text === fname) {
                        const r = div.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                           return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                        }
                     }
                  }
                }
                return null;
             }, filename);
             
             if (imgCoords) {
                await this.humanClick(page, imgCoords.x, imgCoords.y);
                await this.sleep(1000);
                
                // Bấm nút Add to Prompt
                let addPromptCoords = await page.evaluate(() => {
                   const btns = Array.from(document.querySelectorAll('button'));
                   for (let btn of btns) {
                      const text = (btn.innerText || btn.textContent || "").toLowerCase();
                      if (text.includes("add to prompt") || text.includes("thêm vào") || text.includes("lời nhắc")) {
                         const r = btn.getBoundingClientRect();
                         if (r.width > 0 && r.height > 0) {
                            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                         }
                      }
                   }
                   return null;
                });
                
                if (addPromptCoords) {
                   await this.humanClick(page, addPromptCoords.x, addPromptCoords.y);
                   this.log(`✅ Đã thêm ảnh '${filename}' vào prompt.`);
                   await this.sleep(1500); // Chờ menu đóng lại
                } else {
                   this.log(`⚠️ Lỗi: Không tìm thấy nút 'Add to Prompt' cho ảnh '${filename}'.`);
                }
             } else {
                this.log(`⚠️ Lỗi: Không tìm thấy ảnh '${filename}' trong thư viện.`);
             }
          } else {
             this.log(`⚠️ Lỗi: Không mở được tab 'Images' để đính kèm ảnh.`);
          }
        }
    } catch(err) {
      this.log(`⚠️ Lỗi khi đính kèm ảnh từ tab Images: ${err.message}`);
    }
    return true;
  }
  async uploadI2VFrames(page, startImagePath, endImagePath) {
    this.log(`Bắt đầu quy trình upload I2V Frames...`);
    const cleanStart = startImagePath
      ? startImagePath
          .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, "")
          .replace(/^["']|["']$/g, "")
          .trim()
      : null;
    const cleanEnd = endImagePath
      ? endImagePath
          .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, "")
          .replace(/^["']|["']$/g, "")
          .trim()
      : null;

    const uploadBox = async (path, keywords) => {
      if (!path || !fs.existsSync(path)) {
        this.log(
          `⚠️ Bỏ qua frame (${keywords.join("/")}) vì file không tồn tại: ${path}`,
        );
        return;
      }
      this.log(`Tìm ô "${keywords[0]}" để tải lên frame...`);

      let boxCoords = await page.evaluate((kwList) => {
        const getCenter = (r) => {
          return {
            x: Math.round(r.x + r.width / 2),
            y: Math.round(r.y + r.height / 2),
          };
        };
        const isVisible = (el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.height > 0 &&
            window.getComputedStyle(el).visibility !== "hidden"
          );
        };

        const allEls = Array.from(
          document.querySelectorAll(
            'button, div[role="button"], div[role="presentation"], span',
          ),
        );
        for (let el of allEls) {
          if (!isVisible(el)) continue;
          const text = (el.innerText || el.textContent || "")
            .trim()
            .toLowerCase();
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();

          for (let kw of kwList) {
            if (text.includes(kw) || aria.includes(kw)) {
              const r = el.getBoundingClientRect();
              if (r.width > 30 && r.height > 30 && r.width < 500) {
                return getCenter(r);
              }
            }
          }
        }
        return null;
      }, keywords);

      if (boxCoords) {
        this.log(
          `Đã tìm thấy ô chứa keyword "${keywords[0]}" tại [${boxCoords.x}, ${boxCoords.y}]. Đang click...`,
        );
        let attempts = 0;
        let uploaded = false;

        while (attempts < 2 && !uploaded) {
          attempts++;
          await this.humanClick(page, boxCoords.x, boxCoords.y);
          await this.sleep(1500);

          const btnCoords2 = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('div[role="menuitem"], li, button, span'));
            for (let el of items) {
              if (el.getAttribute("role") === "tab") continue;
              const text = (el.innerText || el.textContent || "").toLowerCase();
              if (
                (text.includes("upload media") || text.includes("upload image") ||
                 text.includes("tải nội dung nghe nhìn") || text.includes("tải hình ảnh")) && text.length < 60
              ) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                }
              }
            }
            return null;
          }).catch(() => null);

          if (!btnCoords2) {
             this.log(`⚠️ Lỗi: Không tìm thấy nút Upload trên menu. Text hiện tại không khớp.`);
          }

          let fileChooser = null;
          if (btnCoords2) {
            try {
              const [fc] = await Promise.all([
                page.waitForFileChooser({ timeout: 5000 }).catch(() => null),
                this.humanClick(page, btnCoords2.x, btnCoords2.y)
              ]);
              fileChooser = fc;
            } catch(e) {}
          }

          if (fileChooser) {
            await fileChooser.accept([path]);
            this.log(`✅ Đã đính kèm ảnh: ${path}`);
            await this.sleep(3000); // Chờ UI upload
            uploaded = true;
          } else {
            boxCoords.x += 10;
            boxCoords.y += 10;
            this.log(
              `⚠️ Không mở được File Chooser lần ${attempts}. Thử lại...`,
            );
          }
        }
      } else {
        this.log(
          `❌ Không tìm thấy ô chứa keyword "${keywords[0]}" trên giao diện.`,
        );
      }
    };

    if (cleanStart) {
      await uploadBox(cleanStart, ["bắt đầu", "start", "khung hình đầu"]);
    }

    if (cleanEnd) {
      await uploadBox(cleanEnd, ["kết thúc", "end", "khung hình cuối"]);
    }

    this.log("Chờ 10 giây để hoàn tất xử lý UI cho I2V frames...");
    await this.sleep(10000);
  }

  async submitNewJob(worker) {
    const page = worker.page;
    const job = worker.currentJob;
    this.master.updateJobStatus(job, "Processing");
    this.log(`[Worker ${worker.id}] Bắt đầu xử lý Job ${job.id}...`);

    let targetUrl = worker.projectUrl;

    try {
      let currentUrl = page.url();

      if (targetUrl) {
        // Đã có Project URL cho kịch bản này
        if (!currentUrl.includes(targetUrl)) {
          this.log(
            `[Worker ${worker.id} - BƯỚC 0/5] Chuyển hướng về Project Flow hiện có: ${targetUrl}`,
          );
          await page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await this.sleep(3000 + Math.floor(Math.random() * 2000));

          if (page.url().includes("accounts.google.com/v3/signin")) {
            throw new Error(
              "Cookies hết hạn vui lòng nhập cookies mới để tiếp tục",
            );
          }
        } else {
          this.log(
            `[Worker ${worker.id} - BƯỚC 0/5] Đang ở sẵn giao diện Project Flow, tiếp tục nạp lệnh...`,
          );
        }
      } else {
        // Chưa có Project URL -> Tạo mới
        this.log(
          `[Worker ${worker.id} - BƯỚC 0/5] Bắt đầu Job bằng cách tạo Project mới...`,
        );
        await page.goto("https://labs.google/fx/vi/tools/flow", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await this.sleep(3000 + Math.floor(Math.random() * 2000));

        if (page.url().includes("accounts.google.com/v3/signin")) {
          throw new Error(
            "Cookies hết hạn vui lòng nhập cookies mới để tiếp tục",
          );
        }

        // Tìm nút Dự án mới
        this.log(
          `[Worker ${worker.id}] Tìm nút "Dự án mới" hoặc "Tạo bằng Flow" để bắt đầu Job...`,
        );
        const newProjCoords = await page.evaluate(() => {
          const candidates = Array.from(
            document.querySelectorAll(
              'a, button, div[role="button"], span, div',
            ),
          );
          for (let el of candidates) {
            const text = (el.innerText || el.textContent || "")
              .trim()
              .toLowerCase();
            if (
              text.length > 0 &&
              text.length < 40 &&
              (text.includes("dự án mới") ||
                text.includes("new project") ||
                text.includes("tạo bằng flow") ||
                text.includes("create with flow"))
            ) {
              let target = el;
              while (
                target &&
                target.tagName !== "A" &&
                target.tagName !== "BUTTON" &&
                target.getAttribute("role") !== "button"
              ) {
                if (!target.parentElement || target.tagName === "BODY") break;
                target = target.parentElement;
              }
              target.scrollIntoView({ behavior: "instant", block: "center" });
              const r = target.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
              }
            }
          }
          return null;
        });

        if (newProjCoords) {
          this.log(
            `[Worker ${worker.id}] Tìm thấy nút bắt đầu Project. Tiến hành click...`,
          );
          await this.humanClick(page, newProjCoords.x, newProjCoords.y);
        }

        // Wait for redirect to project url
        this.log(
          `[Worker ${worker.id}] Đang đợi Google tạo Project và redirect...`,
        );
        currentUrl = page.url();
        let retries = 0;
        while (!currentUrl.includes("/project/") && retries < 15) {
          await this.sleep(1000);
          currentUrl = page.url();
          if (currentUrl.includes("accounts.google.com")) {
            throw new Error(
              "Cookies hết hạn vui lòng nhập cookies mới để tiếp tục",
            );
          }
          retries++;
        }

        if (!currentUrl.includes("/project/")) {
          if (currentUrl.includes("accounts.google.com")) {
            throw new Error(
              "Cookies hết hạn vui lòng nhập cookies mới để tiếp tục",
            );
          }
          throw new Error(
            "Timeout khi đợi tạo Project mới. URL hiện tại: " + currentUrl,
          );
        }

        targetUrl = currentUrl;
        this.log(
          `[Worker ${worker.id}] Đã tạo thành công Project mới: ${targetUrl}`,
        );
      }

      // 2. Wait for Editor to load
      await page.waitForSelector('[data-slate-editor="true"]', {
        timeout: 15000,
      });

      // Define Coordinates Map
      const coords = {
        modes: {
          T2V: {
            type: "selector",
            value: 'button[aria-controls$="-content-VIDEO"]',
          },
          IN2V: {
            type: "selector",
            value: 'button[aria-controls$="-content-VIDEO"]',
          },
          I2V: {
            type: "selector",
            value: 'button[aria-controls$="-content-VIDEO"]',
          },
          IMG: {
            type: "selector",
            value: 'button[aria-controls$="-content-IMAGE"]',
          },
          trigger_create_menu: {
            type: "selector",
            value:
              'button[aria-haspopup="menu"]:has(div[data-type="button-overlay"]):not(:has(span))',
          },
        },
        subModes: {
          IN2V: {
            type: "selector",
            value: 'button[aria-controls$="-content-VIDEO_REFERENCES"]',
          },
          I2V: {
            type: "selector",
            value: 'button[aria-controls$="-content-VIDEO_FRAMES"]',
          },
        },
        ratioVideo: {
          Ngang: {
            type: "selector",
            value: 'button[aria-controls$="-content-LANDSCAPE"]',
          },
          Dọc: {
            type: "selector",
            value: 'button[aria-controls$="-content-PORTRAIT"]',
          },
        },
        ratioImage: {
          "16:9": {
            type: "selector",
            value: 'button[aria-controls$="-content-LANDSCAPE"]',
          },
          "9:16": {
            type: "selector",
            value: 'button[aria-controls$="-content-PORTRAIT"]',
          },
          "1:1": {
            type: "selector",
            value: 'button[aria-controls$="-content-SQUARE"]',
          },
          "4:3": {
            type: "selector",
            value: 'button[aria-controls$="-content-LANDSCAPE_4_3"]',
          },
          "3:4": {
            type: "selector",
            value: 'button[aria-controls$="-content-PORTRAIT_3_4"]',
          },
        },
        countVideo: {
          1: { type: "selector", value: 'button[aria-controls$="-content-1"]' },
          2: { type: "selector", value: 'button[aria-controls$="-content-2"]' },
          3: { type: "selector", value: 'button[aria-controls$="-content-3"]' },
          4: { type: "selector", value: 'button[aria-controls$="-content-4"]' },
        },
        countImage: {
          1: { type: "selector", value: 'button[aria-controls$="-content-1"]' },
          2: { type: "selector", value: 'button[aria-controls$="-content-2"]' },
          3: { type: "selector", value: 'button[aria-controls$="-content-3"]' },
          4: { type: "selector", value: 'button[aria-controls$="-content-4"]' },
        },
        durationVideo: {
          "4s": { type: "text", value: ["4s"] },
          "6s": { type: "text", value: ["6s"] },
          "8s": { type: "text", value: ["8s"] },
        },
        model: {
          trigger_video: {
            type: "text",
            value: [
              "Omni Flash",
              "Veo 3.1 - Lite [Lower Priority]",
              "Veo 3.1 - Lite",
              "Veo 3.1 - Fast",
              "Veo",
            ],
          },
          trigger_image: {
            type: "text",
            value: [
              "🍌 Nano Banana Pro",
              "Nano Banana Pro",
              "🍌 Nano Banana 2",
              "nano banana 2",
              "Imagen 3",
              "Imagen 3 Fast",
              "Imagen",
            ],
          },
          "Veo 3.1 - Lite [Lower Priority]": {
            type: "text",
            value: ["Veo 3.1 - Lite [Lower Priority]"],
          },
          "Veo 3.1 - Fast": { type: "text", value: ["Veo 3.1 - Fast"] },
          "Nano Banana Pro": {
            type: "text",
            value: ["🍌 Nano Banana Pro", "Nano Banana Pro"],
          },
          "nano banana 2": {
            type: "text",
            value: ["🍌 Nano Banana 2", "nano banana 2"],
          },
        },
        submitBtn: { type: "text", value: ["arrow_forward"] }, // From recorder
        viewMode: {
          trigger: { type: "text", value: ["settings_2"] },
          batch: {
            type: "selector",
            value: 'button[aria-label="Theo nhóm"], button[aria-label="Batch"]',
          }, // Override for safety since original is "Theo nhóm" but wait, the recorder got selector "button[aria-label="Theo nhóm"]", great!
          size_S: { type: "text", value: ["S"] },
          sound_off: {
            type: "text",
            value: ["Âm thanh khi di chuột", "Sound"],
          },
          return_silent: { type: "text", value: ["Return silent videos"] },
          info_on: {
            type: "text",
            value: ["Hiện thông tin chi tiết về ô", "Show info"],
          },
          clear_off: {
            type: "text",
            value: ["Xoá câu lệnh sau khi gửi", "Clear prompt"],
          },
        },
      };

      const clickDynamicNode = async (map, key) => {
        if (!key || !map) return false;
        const c = map[key];
        if (!c) return false;
        let coordsXY = null;
        if (c.type === "text") {
          coordsXY = await this.findNodeByTextExact(page, c.value);
        } else if (c.type === "selector") {
          coordsXY = await this.findNodeBySelector(page, c.value);
        }

        if (coordsXY) {
          await this.humanClick(page, coordsXY.x, coordsXY.y);
          await this.sleep(400);
          return true;
        } else {
          this.log(`⚠️ Lỗi DOM Scan: Không tìm thấy phần tử cho [${key}]`);
          return false;
        }
      };

      const isImg = job.isImageTask === true;
      let TYPE_VIDEO = "IN2V"; // Luôn chọn Ingredients to Video cho các tác vụ Video
      if (isImg) {
        TYPE_VIDEO = "IMG";
      }
      const prompt = job.prompt || "";
      const settings = job.settings || {};
      const currentSettings = isImg
        ? settings.imgSettings
        : settings.videoSettings;
      // Mở Create Menu
      this.log(`[BƯỚC 1/5] Bắt đầu cấu hình Job - Mở menu cấu hình...`);
      await clickDynamicNode(coords.modes, "trigger_create_menu");
      await this.sleep(1000 + Math.floor(Math.random() * 1000));

      if (coords.modes[TYPE_VIDEO]) {
        this.log(`[BƯỚC 2/5] Đang chọn chế độ: ${TYPE_VIDEO}`);
        const clickedMode = await clickDynamicNode(coords.modes, TYPE_VIDEO);
        if (!clickedMode) {
          throw new Error(
            `Không tìm thấy chế độ ${TYPE_VIDEO} trong Config Menu. Hủy Job!`,
          );
        }
        await this.sleep(1000 + Math.floor(Math.random() * 800));

        if (TYPE_VIDEO === "IN2V" || TYPE_VIDEO === "I2V") {
          this.log(
            `[BƯỚC 2b/5] Đang chuyển sang tab thành phần / khung hình phụ trợ...`,
          );
          const clickedSubMode = await clickDynamicNode(
            coords.subModes,
            TYPE_VIDEO,
          );

          if (!clickedSubMode) {
            throw new Error(
              `Không tìm thấy Tab phụ trợ cho ${TYPE_VIDEO} trong Config Menu. Có thể Google Veo đã thay đổi giao diện. Hủy Job!`,
            );
          }
          await this.sleep(800 + Math.floor(Math.random() * 500));
        }

        if (currentSettings) {
          const clickCoord = async (map, key) => {
            await clickDynamicNode(map, key);
            await this.sleep(400 + Math.floor(Math.random() * 400));
          };

          if (isImg) {
            await clickCoord(coords.ratioImage, currentSettings.ratio);
            await clickCoord(
              coords.countImage,
              currentSettings.count?.toString(),
            );
            if (currentSettings.model)
              await this.clickModelDropdownWithVerify(
                page,
                clickCoord,
                coords,
                "trigger_image",
                currentSettings.model,
              );
          } else {
            let ratioKey = currentSettings.ratio;
            if (ratioKey === "16:9") ratioKey = "Ngang";
            if (ratioKey === "9:16") ratioKey = "Dọc";
            await clickCoord(coords.ratioVideo, ratioKey);
            await clickCoord(
              coords.countVideo,
              currentSettings.count?.toString(),
            );
            await clickCoord(coords.durationVideo, "8s");
            if (currentSettings.model)
              await this.clickModelDropdownWithVerify(
                page,
                clickCoord,
                coords,
                "trigger_video",
                currentSettings.model,
              );
          }
        }
      }

      // Đóng menu một cách an toàn bằng phím Escape, tránh click nhầm vào ảnh ở background
      await page.keyboard.press("Escape");
      await this.sleep(200 + Math.floor(Math.random() * 300));
      await page.keyboard.press("Escape"); // Ấn thêm lần nữa để đóng mọi overlay rác nếu có
      await this.sleep(800 + Math.floor(Math.random() * 600));

      // Xóa editor và nhập prompt qua CDP
      this.log(`[BƯỚC 3/5] Click focus vào ô nhập lệnh (Editor)...`);
      await page.click('[data-slate-editor="true"]').catch(() => {});
      await this.sleep(200 + Math.floor(Math.random() * 200));

      // Clear old text by clicking the X button
      this.log(`[BƯỚC 3b/5] Xóa câu lệnh cũ (Clear prompt)...`);
      await page.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll("button"));
        for (const btn of allBtns) {
          const spans = Array.from(btn.querySelectorAll("span"));
          const hasXLabel = spans.some(
            (s) =>
              s.textContent.trim() === "Xoá câu lệnh" ||
              s.textContent.trim() === "Clear prompt",
          );
          const googleIcon = btn.querySelector(
            'i.google-symbols, i[class*="google-symbols"]',
          );
          const hasCloseIcon =
            googleIcon && googleIcon.textContent.trim() === "close";
          if (hasXLabel || hasCloseIcon) {
            const r = btn.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              btn.click();
              return true;
            }
          }
        }
        return false;
      });
      await this.sleep(400 + Math.floor(Math.random() * 300));

      // Helper to save Base64 to temp file
      const processImagePath = (imgPath) => {
        if (!imgPath) return imgPath;
        if (imgPath.startsWith("data:image/")) {
          const crypto = require("crypto");
          const tmpDir = require("os").tmpdir();
          const ext = imgPath.split(";")[0].split("/")[1] || "png";
          const base64Data = imgPath.replace(/^data:image\/\w+;base64,/, "");
          const tmpPath = path.join(
            tmpDir,
            `veo3_in2v_${crypto.randomBytes(8).toString("hex")}.${ext}`,
          );
          fs.writeFileSync(tmpPath, base64Data, "base64");
          return tmpPath;
        }
        return imgPath;
      };

      // Không gọi processImagePath cho IN2V vì ta dùng Gallery (không upload file local)
      this.log(`[BƯỚC 4/5] Đang chọn ảnh đính kèm từ Thư viện...`);
      let IMAGE_PATH = job.image1 || job.imageURL;
      let IMAGE_PATH_2 = job.image2;
      let IMAGE_PATH_3 = job.image3;

      let selectResult = true;
      if (TYPE_VIDEO === "IN2V") {
        if (job.images && job.images.length > 0) {
          this.log(
            `[BƯỚC 4/5] Phát hiện Local Images cho IN2V. Tiến hành upload trực tiếp...`,
          );
          selectResult = await this.uploadLocalImagesIN2V(page, job.images);
        } else {
          selectResult = await this.selectImagesFromGallery(
            page,
            [IMAGE_PATH, IMAGE_PATH_2, IMAGE_PATH_3],
            job,
          );
        }
      } else if (TYPE_VIDEO === "I2V") {
        // Với I2V (Image to Video frames), nếu người dùng có upload frame tùy chỉnh, ta dùng processImagePath
        IMAGE_PATH = processImagePath(IMAGE_PATH);
        IMAGE_PATH_2 = processImagePath(IMAGE_PATH_2);
        await this.uploadI2VFrames(page, IMAGE_PATH, IMAGE_PATH_2);
      }

      // FAIL-FAST: Dừng Job nếu chọn ảnh thất bại
      if (TYPE_VIDEO === "IN2V" && selectResult === false) {
        throw new Error(
          "Không thể chọn ảnh nhân vật từ Gallery. Hủy Job để tránh sinh sai kết quả.",
        );
      }

      // Add Job ID signature to prompt
      const trackingSignature = `\n\n[Ignore this: JobID=${job.id}]`;
      let cleanPrompt =
        prompt
          .replace(/--ar\s+\d+[:-]\d+/gi, "")
          .replace(/--ar \d+\/\d+/gi, "")
          .trim() + trackingSignature;

      this.log(
        `[Worker ${worker.id} - BƯỚC 5/5] Chuẩn bị Paste câu lệnh (Prompt) và Submit... (Length: ${cleanPrompt.length})`,
      );

      // Đảm bảo editor được focus (nếu click trước đó bị overlay nuốt)
      await page.focus('[data-slate-editor="true"]').catch(() => {});
      await page.click('[data-slate-editor="true"]').catch(() => {});
      await this.sleep(200 + Math.floor(Math.random() * 300));

      // --- STAGGER SUBMISSION (Căn chỉnh tab gửi so le nhau) ---
      const now = Date.now();
      const timeSinceLastSubmit = now - this.lastSubmitTime;
      // random 5-10 giây khoảng cách giữa 2 lần submit của bất kỳ tab nào
      const requiredStaggerTime = Math.floor(Math.random() * 5000) + 5000;
      if (timeSinceLastSubmit < requiredStaggerTime) {
        const waitTime = requiredStaggerTime - timeSinceLastSubmit;
        this.log(
          `[Worker ${worker.id}] Đang căn chỉnh gửi xen kẽ. Chờ thêm ${Math.floor(waitTime / 1000)}s rồi mới nhập lệnh...`,
        );
        await this.sleep(waitTime);
      }
      // --------------------------------------------------------

      // Dùng Playwright CDP Session để insert text
      const client = await this.browser.newCDPSession(page);
      await client.send("Input.insertText", { text: cleanPrompt });
      await client.detach();
      await this.sleep(500);

      // Cực kỳ quan trọng: Gõ phím Space và Backspace để đánh thức React JS
      // Nếu không, nút Submit (Create) sẽ bị aria-disabled="true" và click không có tác dụng
      await page.focus('[data-slate-editor="true"]');
      await page.keyboard.press("Space");
      await this.sleep(100);
      await page.keyboard.press("Backspace");
      await this.sleep(500);

      // Đánh dấu thời điểm submit của Tab này để các Tab khác biết đường né
      this.lastSubmitTime = Date.now();

      // Giả lập hành vi người dùng: cuộn trang và click tab ngẫu nhiên trước khi submit
      this.log(
        `[Worker ${worker.id} - BƯỚC 5b/5] Giả lập hành vi người dùng: Cuộn trang và click an toàn trước khi bấm Submit...`,
      );
      await this.humanScroll(page);
      await this.sleep(800 + Math.floor(Math.random() * 1000));
      // Click ra một khoảng trống an toàn (góc trên bên trái, header) để tránh kẹt focus
      await page.mouse.click(
        Math.floor(Math.random() * 150) + 10,
        Math.floor(Math.random() * 50) + 10,
      );
      await this.sleep(500 + Math.floor(Math.random() * 1000));

      this.log(`[SUBMIT] Bấm Submit...`);
      let clicked = await clickDynamicNode(coords, "submitBtn");
      if (!clicked) {
        this.log("Fallback: Bấm Enter...");
        await page.focus('[data-slate-editor="true"]');
        await page.keyboard.press("Enter");
      }

      this.log(
        "[CHỜ KẾT QUẢ] Đang chờ hệ thống xác nhận đã gửi lệnh (Đang tạo / % Render)...",
      );
      let isSubmitted = false;
      let errorToast = null;

      for (let check = 0; check < 15; check++) {
        await this.sleep(1000);

        const status = await page
          .evaluate(() => {
            const alerts = Array.from(
              document.querySelectorAll(
                '[role="alert"], [class*="snackbar"], snack-bar, .msg, .toast, .error',
              ),
            );
            for (let a of alerts) {
              if (a.offsetParent === null) continue;
              const t = (a.innerText || "").trim().toLowerCase();
              if (
                t.length > 5 &&
                (t.includes("vi phạm") ||
                  t.includes("chính sách") ||
                  t.includes("policy") ||
                  t.includes("cấm") ||
                  t.includes("error") ||
                  t.includes("lỗi") ||
                  t.includes("could not") ||
                  t.includes("không thể"))
              ) {
                return { type: "error", msg: a.innerText.trim() };
              }
            }

            const texts = Array.from(document.querySelectorAll("span, div, p"));
            const isRunning = texts.some((el) => {
              if (el.offsetParent === null) return false;
              const t = el.textContent.trim();
              if (
                t.includes("Đang tạo") ||
                t.includes("Generating") ||
                t.includes("Creating") ||
                t.includes("Queued") ||
                t.includes("Đang trong hàng đợi")
              )
                return true;
              return /^\d{1,3}%$/.test(t);
            });

            if (isRunning) return { type: "running" };

            const editor = document.querySelector('[data-slate-editor="true"]');
            if (editor && editor.innerText.trim().length < 5) {
              return { type: "cleared" };
            }

            return { type: "waiting" };
          })
          .catch(() => ({ type: "waiting" }));

        if (status.type === "error") {
          errorToast = status.msg;
          break;
        } else if (status.type === "running" || status.type === "cleared") {
          isSubmitted = true;
          break;
        }
      }

      if (errorToast) {
        const errDir =
          this.accountData.outputDir ||
          path.join(this.profilePath, "..", "outputs");
        if (!fs.existsSync(errDir)) fs.mkdirSync(errDir, { recursive: true });
        const errPic = path.join(
          errDir,
          `error_policy_${job.id}_${Date.now()}.png`,
        );
        await page.screenshot({ path: errPic, fullPage: true }).catch(() => {});
        throw new Error(
          `Google từ chối Prompt: "${errorToast}". Màn hình: ${errPic}`,
        );
      }

      if (!isSubmitted) {
        const errDir =
          this.accountData.outputDir ||
          path.join(this.profilePath, "..", "outputs");
        if (!fs.existsSync(errDir)) fs.mkdirSync(errDir, { recursive: true });
        const errPic = path.join(
          errDir,
          `error_submit_${job.id}_${Date.now()}.png`,
        );
        await page.screenshot({ path: errPic, fullPage: true }).catch(() => {});

        throw new Error(
          `Job không thể Submit (Nút Generate không hoạt động hoặc Tool bị kẹt). Xem ảnh: ${errPic}`,
        );
      }

      await this.sleep(3000);

      this.master.updateJobStatus(job, "Rendering");
      this.log(`Submit Job ${job.id} hoàn tất! Tab sẽ đi nạp Job khác.`);
      return targetUrl;
    } catch (e) {
      this.log(`UI Error during submit: ${e.message}`);
      throw e;
    }
  }

  async checkJobStatus(worker) {
    const page = worker.page;
    const job = worker.currentJob;
    const projectUrl = worker.projectUrl;

    this.log(
      `[Worker ${worker.id}] Đang kiểm tra tiến độ Job ${job.id} tại: ${projectUrl}`,
    );

    try {
      if (!page.url().includes(projectUrl)) {
        await page.goto(projectUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await this.sleep(4000);
      }

      const evaluateResult = await page.evaluate((jobId) => {
        const allDivs = document.querySelectorAll("div, span, p");
        for (let i = 0; i < allDivs.length; i++) {
          const text = (allDivs[i].textContent || allDivs[i].innerText || "")
            .trim()
            .toLowerCase();
          if (text.includes("we noticed some unusual activity")) {
            return { status: "unusual_activity" };
          }
        }

        const alerts = Array.from(
          document.querySelectorAll(
            '[role="alert"], snack-bar, .msg, .error, .toast',
          ),
        );
        for (let a of alerts) {
          if (a.offsetParent !== null) {
            const t = (a.innerText || "").toLowerCase();
            if (
              t.includes("vi phạm") ||
              t.includes("chính sách") ||
              t.includes("lỗi") ||
              t.includes("error") ||
              t.includes("không thể")
            ) {
              return { status: "error", msg: a.innerText.trim() };
            }
          }
        }

        let hasPercent = false;
        let currentPercent = "";
        const percentDivs = document.querySelectorAll("div, span, p");
        for (let i = 0; i < percentDivs.length; i++) {
          const text = (
            percentDivs[i].textContent ||
            percentDivs[i].innerText ||
            ""
          ).trim();
          if (/^\d{1,3}%$/.test(text)) {
            hasPercent = true;
            currentPercent = text;
            break;
          }
          if (
            text === "Đang tạo" ||
            text === "Generating" ||
            text === "Creating" ||
            text === "Queued" ||
            text === "Đang trong hàng đợi"
          ) {
            hasPercent = true;
            break;
          }
        }

        if (hasPercent) {
          return { status: "generating", percent: currentPercent };
        }

        return { status: "done_rendering" };
      }, job.id);

      if (evaluateResult.status === "error") {
        throw new Error("Lỗi Render trên Google: " + evaluateResult.msg);
      }

      if (evaluateResult.status === "unusual_activity") {
        this.log(
          `⚠️ Phát hiện lỗi "Unusual activity". Đang chờ 2s để bấm nút Go Back...`,
        );
        await this.sleep(2000);

        let goBackCoords = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          for (let b of btns) {
            const txt = (b.innerText || "").toLowerCase();
            if (txt.includes("go back") || b.innerHTML.includes("arrow_back")) {
              const r = b.getBoundingClientRect();
              if (r.width > 0 && r.height > 0)
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }
          }
          return null;
        });

        if (goBackCoords) {
          this.log("Tìm thấy nút Go Back. Đang click...");
          await this.humanClick(page, goBackCoords.x, goBackCoords.y);
        } else {
          this.log("Không tìm thấy nút Go Back. Thử evaluate click...");
          await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button"));
            for (let b of btns) {
              const txt = (b.innerText || "").toLowerCase();
              if (
                txt.includes("go back") ||
                b.innerHTML.includes("arrow_back")
              ) {
                b.click();
              }
            }
          });
        }

        this.log("Đã click Go Back. Chờ 3s để trở về project...");
        await this.sleep(3000);

        const stillError = await page.evaluate(() => {
          const allDivs = document.querySelectorAll("div, span, p");
          for (let i = 0; i < allDivs.length; i++) {
            const text = (allDivs[i].textContent || allDivs[i].innerText || "")
              .trim()
              .toLowerCase();
            if (text.includes("we noticed some unusual activity")) return true;
          }
          return false;
        });

        if (stillError) {
          this.log(
            "⚠️ Vẫn còn lỗi Unusual activity. Đang click Go Back lần 2 để ra ngoài...",
          );
          let goBack2 = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button"));
            for (let b of btns) {
              const txt = (b.innerText || "").toLowerCase();
              if (
                txt.includes("go back") ||
                b.innerHTML.includes("arrow_back")
              ) {
                const r = b.getBoundingClientRect();
                if (r.width > 0 && r.height > 0)
                  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
              }
            }
            return null;
          });
          if (goBack2) {
            await this.humanClick(page, goBack2.x, goBack2.y);
          } else {
            await page.evaluate(() => {
              const btns = Array.from(document.querySelectorAll("button"));
              for (let b of btns) {
                const txt = (b.innerText || "").toLowerCase();
                if (
                  txt.includes("go back") ||
                  b.innerHTML.includes("arrow_back")
                ) {
                  b.click();
                }
              }
            });
          }

          await this.sleep(2000);
          this.log("Đã ấn Go Back ra ngoài. Đang F5 lại trang...");
          await page
            .reload({ waitUntil: "domcontentloaded", timeout: 30000 })
            .catch(() => {});

          const waitTime =
            Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000;
          this.log(
            `[Worker ${worker.id}] Đã F5. Chờ ngẫu nhiên ${Math.floor(waitTime / 1000)}s trước khi tạo project mới...`,
          );
          await this.sleep(waitTime);

          this.log(
            `[Worker ${worker.id}] Tiến hành tạo Project mới và submit lại Job từ đầu...`,
          );
          worker.projectUrl = null;
          const newProjectUrl = await this.submitNewJob(worker);
          if (newProjectUrl) {
            worker.projectUrl = newProjectUrl;
            worker.startTime = Date.now();
          } else {
            throw new Error(
              "Không thể tạo Project mới sau khi phục hồi từ Unusual Activity.",
            );
          }
          return false;
        } else {
          this.log(
            `[Worker ${worker.id}] Đã hết lỗi Unusual Activity, đang ở trong Project. Đợi 5s và xoay chuột...`,
          );

          let editorCoords = null;
          for (let i = 0; i < 10; i++) {
            editorCoords = await this.findNodeBySelector(
              page,
              '[data-slate-editor="true"]',
            );
            if (editorCoords) break;
            await this.sleep(500);
          }

          if (editorCoords) {
            const cx = editorCoords.x;
            const cy = editorCoords.y;
            const r = 40;
            for (let c = 0; c < 3; c++) {
              for (let angle = 0; angle < Math.PI * 2; angle += 0.4) {
                await page.mouse.move(
                  cx + r * Math.cos(angle),
                  cy + r * Math.sin(angle),
                );
                await this.sleep(30);
              }
            }
          } else {
            await this.sleep(3000);
          }

          this.log(`Đã chờ xong. Bấm vào ô nhập lệnh để paste prompt lại...`);
          if (editorCoords) {
            await this.humanClick(page, editorCoords.x, editorCoords.y);
          } else {
            await page.click('[data-slate-editor="true"]').catch(() => {});
          }
          await this.sleep(500);

          const prompt = job.prompt || "";
          const trackingSignature = `\n\n[Ignore this: JobID=${job.id}]`;
          let cleanPrompt =
            prompt
              .replace(/--ar\s+\d+[:-]\d+/gi, "")
              .replace(/--ar \d+\/\d+/gi, "")
              .trim() + trackingSignature;

          const client = await this.browser.newCDPSession(page);
          await client.send("Input.insertText", { text: cleanPrompt });
          await client.detach();
          await this.sleep(1000);

          this.log(`Bấm Submit lại (arrow_forward)...`);
          let submitCoords = await this.findNodeByTextExact(page, [
            "arrow_forward",
          ]);
          if (submitCoords) {
            await this.humanClick(page, submitCoords.x, submitCoords.y);
          } else {
            await page.keyboard.press("Enter");
          }

          await this.sleep(3000);
          worker.percentSeen = false;
          worker.waitingWithoutPercent = 0;
          return false;
        }
      }

      if (evaluateResult.status === "generating") {
        worker.percentSeen = true;
        worker.waitingWithoutPercent = 0;
        if (evaluateResult.percent) {
          this.log(
            `[Worker ${worker.id}] Tiến trình Job ${job.id}: ${evaluateResult.percent}`,
          );
        }
        this.master.updateJobStatus(job, "Rendering");

        worker.viewedVideoCount = worker.viewedVideoCount || 0;

        if (worker.viewedVideoCount < 2 && Math.random() < 0.15) {
          const videoCoords = await page.evaluate(() => {
            const videos = Array.from(document.querySelectorAll("video"));
            const validVideos = videos.filter((v) => {
              const r = v.getBoundingClientRect();
              return r.width > 50 && r.height > 50 && v.offsetParent !== null;
            });

            if (validVideos.length > 0) {
              const randVid =
                validVideos[Math.floor(Math.random() * validVideos.length)];
              const r = randVid.getBoundingClientRect();
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }
            return null;
          });

          if (videoCoords) {
            await this.humanClick(page, videoCoords.x, videoCoords.y);
            worker.viewedVideoCount++;
            await this.sleep(1000 + Math.floor(Math.random() * 1500));

            const backCoords = await page.evaluate(() => {
              const btns = Array.from(document.querySelectorAll("button"));
              for (let b of btns) {
                const txt = (b.innerText || "").toLowerCase();
                if (
                  txt.includes("quay lại") ||
                  txt.includes("go back") ||
                  b.innerHTML.includes("arrow_back")
                ) {
                  const r = b.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0)
                    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                }
              }
              return null;
            });

            if (backCoords) {
              await this.humanClick(page, backCoords.x, backCoords.y);
            } else {
              await page.keyboard.press("Escape");
            }
            await this.sleep(1000);
          }
        }

        return false;
      }

      if (evaluateResult.status === "done_rendering") {
        if (!worker.percentSeen) {
          worker.waitingWithoutPercent =
            (worker.waitingWithoutPercent || 0) + 1;
          if (worker.waitingWithoutPercent < 10) {
            this.log(
              `[Worker ${worker.id}] Job ${job.id} đang chờ hệ thống xếp hàng (chưa thấy tiến trình)...`,
            );
            return false;
          }
        } else {
          await this.sleep(5000);
        }
      }

      if (!worker.hasReloaded) {
        this.log(
          `[Worker ${worker.id}] Job ${job.id} đã hoàn thành render. Đang F5 lại trang để đồng bộ API...`,
        );
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
        await this.sleep(8000);
        worker.hasReloaded = true;
      }

      // 6. Lấy Project ID và gọi API ẩn
      const pIdMatch = projectUrl.match(/\/project\/([a-zA-Z0-9\-]+)/);
      const pId = pIdMatch ? pIdMatch[1] : "";

      if (!pId) {
        this.log("Không lấy được Project ID từ URL!");
        return false;
      }

      const mediaUrl = await page.evaluate(
        async ({ jobId, projectId }) => {
          try {
            const apiUrl = `https://labs.google/fx/api/trpc/project.searchProjectWorkflows?input={"json":{"pageSize":10,"projectId":"${projectId}","toolName":"PINHOLE","fetchBookmarked":false,"rawQuery":"","cursor":null},"meta":{"values":{"cursor":["undefined"]}}}`;
            const res = await fetch(apiUrl);
            const jsonData = await res.json();
            const workflows =
              jsonData?.result?.data?.json?.result?.workflows || [];

            for (let i = 0; i < workflows.length; i++) {
              const steps = workflows[i].workflowSteps || [];
              for (let j = 0; j < steps.length; j++) {
                const step = steps[j] || {};
                let prompt = "";
                try {
                  prompt =
                    step.workflowStepLog.requestData.promptInputs[0]
                      .structuredPrompt.parts[0].text || "";
                } catch (e2) {}

                if (prompt.includes(`JobID=${jobId}`)) {
                  const gens = step.mediaGenerations || [];
                  for (let k = 0; k < gens.length; k++) {
                    let url =
                      gens[k].mediaData?.videoData?.fifeUri ||
                      gens[k].mediaData?.imageData?.fifeUri ||
                      "";
                    if (url) return url;
                  }
                }
              }
            }
            return null;
          } catch (e) {
            return null;
          }
        },
        { jobId: job.id, projectId: pId },
      );

      if (!mediaUrl) {
        job.apiRetries = (job.apiRetries || 0) + 1;
        if (job.apiRetries > 3) {
          throw new Error(
            "Không thể trích xuất Media URL từ API sau 3 lần thử. Khả năng cao Google đã chặn hoặc render thất bại ngầm. Bỏ qua Job này.",
          );
        }
        this.log(
          `Chưa lấy được link từ API (Thử lần ${job.apiRetries}/3). Sẽ thử lại ở vòng lặp sau...`,
        );
        return false;
      }

      this.log(
        `Job ${job.id} ĐÃ HOÀN THÀNH (100%)! Tìm thấy link tải từ API: ${mediaUrl.substring(0, 50)}...`,
      );
      await this.sleep(3000);
      this.master.updateJobStatus(job, "Downloading");

      const isCharacterJob =
        job.typeI2V === "Character" ||
        job.typeI2V === "Avatar" ||
        !!job.characterId;
      let finalDir;
      if (job.excelFilePath) {
        const excelDir = path.dirname(job.excelFilePath);
        finalDir = path.join(excelDir, job.excelFileName || job.id.toString());
      } else {
        const outputDir =
          typeof this.master.getJobOutputDir === "function"
            ? this.master.getJobOutputDir(
                job.projectId,
                isCharacterJob,
                job.outputDir,
              )
            : job.outputDir
              ? path.join(this.master.outputDir, job.outputDir)
              : this.master.outputDir;
        finalDir = outputDir;
        if (job.excelFileName) {
          finalDir = path.join(outputDir, job.excelFileName);
        }
      }

      const safeProjectName = (
        job.projectName ||
        job.projectId ||
        "Veo3_Downloads"
      ).replace(/[<>:"/\\|?*]+/g, "_");
      const rootDrive = process.platform === "win32" ? "C:\\" : "/tmp/";
      finalDir = path.join(rootDrive, safeProjectName);

      const fs = require("fs");
      if (!fs.existsSync(finalDir)) {
        fs.mkdirSync(finalDir, { recursive: true });
      }

      const targetFileName = job.targetFileName || job.id.toString();

      const targetExt = job.isImageTask ? "png" : "mp4";
      const base64Data = { mediaUrl: mediaUrl, ext: targetExt, isBlob: false };

      if (!base64Data || base64Data.error) {
        if (base64Data && base64Data.error === "DEBUG_DOM") {
          const debugFile = path.join(finalDir, `debug_dom_${job.id}.html`);
          fs.writeFileSync(debugFile, base64Data.html || "No HTML");
          this.log(`⚠️ Đã dump HTML DOM ra file ${debugFile} để phân tích.`);
          return false;
        }
        const errorMsg =
          base64Data && base64Data.error ? base64Data.error : "Unknown";
        this.log(
          `⚠️ Không lấy được thông tin media cho Job ${job.id}! Lỗi: ${errorMsg}. Thử lại sau.`,
        );
        if (errorMsg !== "WAIT_FOR_IMAGE_LOAD") {
          job.downloadRetries = (job.downloadRetries || 0) + 1;
          if (job.downloadRetries >= 5) {
            throw new Error(
              `Không lấy được thông tin media sau 5 lần thử: ${errorMsg}`,
            );
          }
        }
        await this.sleep(3000);
        return false;
      }

      const fileNameWithExt = targetFileName.endsWith(`.${base64Data.ext}`)
        ? targetFileName
        : `${targetFileName}.${base64Data.ext}`;
      const finalPath = path.join(finalDir, fileNameWithExt);

      if (base64Data.isBlob) {
        this.log(`Tải thành công Base64 (Blob) cho Job ${job.id}.`);
        const base64Str = base64Data.dataUrl.split(",")[1];
        fs.writeFileSync(finalPath, base64Str, "base64");
      } else {
        this.log(
          `Bắt đầu Stream file media trực tiếp cho Job ${job.id}: ${base64Data.mediaUrl.substring(0, 60)}...`,
        );
        try {
          const https = require("https");

          const cookies = await page.context().cookies();
          const cookieStr = cookies
            .map((c) => `${c.name}=${c.value}`)
            .join("; ");
          const userAgent = await page.evaluate(() => navigator.userAgent);

          await new Promise((resolve, reject) => {
            const req = https.get(
              base64Data.mediaUrl,
              {
                headers: {
                  Cookie: cookieStr,
                  "User-Agent": userAgent,
                },
              },
              (res) => {
                if (
                  res.statusCode >= 300 &&
                  res.statusCode < 400 &&
                  res.headers.location
                ) {
                  this.log(`Đang redirect sang: ${res.headers.location}`);
                  https
                    .get(res.headers.location, (resRedir) => {
                      const fileStream = fs.createWriteStream(finalPath);
                      resRedir.pipe(fileStream);
                      resRedir.on("end", () => resolve(true));
                      resRedir.on("error", reject);
                      fileStream.on("error", reject);
                    })
                    .on("error", reject);
                } else if (res.statusCode === 200) {
                  const fileStream = fs.createWriteStream(finalPath);
                  res.pipe(fileStream);
                  res.on("end", () => resolve(true));
                  res.on("error", reject);
                  fileStream.on("error", reject);
                } else {
                  reject(
                    new Error(`Failed with status code: ${res.statusCode}`),
                  );
                }
              },
            );
            req.on("error", reject);
          });
          this.log(`Stream thành công file media vào ổ cứng cho Job ${job.id}`);
        } catch (err) {
          this.log(`Lỗi tải trực tiếp media cho Job ${job.id}: ${err.message}`);
          job.downloadRetries = (job.downloadRetries || 0) + 1;
          if (job.downloadRetries >= 3) {
            throw new Error(
              `Lỗi stream HTTP trực tiếp media sau 3 lần thử: ${err.message}`,
            );
          }
          await this.sleep(4000);
          return false;
        }
      }

      this.master.updateJobStatus(
        job,
        "Completed",
        undefined,
        finalPath,
        base64Data.mediaUrl,
      );
      return true;
    } catch (e) {
      this.log(`Lỗi trong quá trình check Job ${job.id}: ${e.message}`);
      throw e;
    }
  }
}
module.exports = Veo3PipelineController;
