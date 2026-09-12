const $ = (id) => document.getElementById(id);

const loginSection = $("login-section");
const registerSection = $("register-section");
const dashboardSection = $("dashboard-section");
const accountStatus = $("account-status");

const loginForm = $("login-form");
const registerForm = $("register-form");
const depositForm = $("deposit-form");
const withdrawForm = $("withdraw-form");
const transferForm = $("transfer-form");
const passwordForm = $("password-form");

const loginMessage = $("login-message");
const registerMessage = $("register-message");
const actionMessage = $("action-message");

const formatter = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
});

let transactionHistory = [];
let token = localStorage.getItem("bankingToken");
let currentUser = null;

function formatMoney(value) {
  return formatter.format(Number(value));
}

function showLogin(message = "") {
  loginSection.hidden = false;
  registerSection.hidden = true;
  dashboardSection.hidden = true;
  loginMessage.textContent = message;
}

function showRegister() {
  loginSection.hidden = true;
  registerSection.hidden = false;
  dashboardSection.hidden = true;
  registerMessage.textContent = "";
}

function logout(message = "") {
  localStorage.removeItem("bankingToken");
  token = null;
  currentUser = null;
  loginForm.reset();
  showLogin(message);
}

async function api(url, options = {}) {
  const headers = {
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.message || "Request failed");
    error.status = response.status;
    throw error;
  }

  return data;
}

function showDashboard(account) {
  currentUser = account;

  if (account.is_frozen) {
    accountStatus.hidden = false;
    accountStatus.textContent =
      "This account is frozen. You can receive deposits, but withdrawals and transfers are disabled.";
  } else {
    accountStatus.hidden = true;
    accountStatus.textContent = "";
  }

  $("customer-name").textContent = account.full_name;
  $("balance").textContent = formatMoney(account.balance);
  $("total-deposits").textContent = formatMoney(account.total_deposits);
  $("total-withdrawals").textContent = formatMoney(account.total_withdrawals);
  $("total-sent").textContent = formatMoney(account.total_sent);
  $("total-received").textContent = formatMoney(account.total_received);

  loginSection.hidden = true;
  registerSection.hidden = true;
  dashboardSection.hidden = false;
}

function renderTransactions(transactions) {
  const list = $("transaction-list");
  list.innerHTML = "";
  $("transaction-count").textContent = `${transactions.length} total`;

  if (transactions.length === 0) {
    list.textContent = "No transactions yet.";
    return;
  }

  transactions.forEach((transaction) => {
    const item = document.createElement("article");
    const type = document.createElement("strong");
    const amount = document.createElement("span");
    const description = document.createElement("small");
    const date = document.createElement("time");

    item.className = "transaction-item";
    type.textContent = transaction.transaction_type.replace("_", " ");
    amount.textContent = formatMoney(transaction.amount);
    description.textContent = transaction.description;
    date.textContent = new Date(transaction.created_at).toLocaleString();

    item.append(type, amount, description, date);
    list.appendChild(item);
  });
}

async function loadDashboard() {
  if (!token) {
    showLogin();
    return;
  }

  try {
    const [summary, history] = await Promise.all([
      api("/api/me/summary"),
      api("/api/me/transactions"),
    ]);

    showDashboard(summary.account);
    transactionHistory = history.transactions;
    renderTransactions(history.transactions);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      logout("Your session has expired. Please sign in again.");
      return;
    }

    showLogin(`Could not load dashboard: ${error.message}`);
  }
}

async function submitMoneyAction(url, body, successMessage, form) {
  actionMessage.textContent = "";

  try {
    await api(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    form.reset();
    actionMessage.textContent = successMessage;
    await loadDashboard();
  } catch (error) {
    actionMessage.textContent = error.message;
  }
}

function downloadStatement() {
  const rows = [
    ["Type", "Amount", "Description", "Date"],
    ...transactionHistory.map((transaction) => [
      transaction.transaction_type,
      transaction.amount,
      transaction.description,
      new Date(transaction.created_at).toLocaleString(),
    ]),
  ];

  const csv = rows
    .map((row) =>
      row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")
    )
    .join("\n");

  const file = new Blob([csv], {
    type: "text/csv;charset=utf-8",
  });

  const url = URL.createObjectURL(file);
  const link = document.createElement("a");

  link.href = url;
  link.download = "banking-statement.csv";
  link.click();

  URL.revokeObjectURL(url);
}

$("download-statement-button").addEventListener(
  "click",
  downloadStatement
);

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: $("email").value,
        password: $("password").value,
      }),
    });

    token = data.token;
    localStorage.setItem("bankingToken", token);

    if (data.user.role === "admin") {
      window.location.href = "/admin.html";
      return;
    }

    await loadDashboard();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  registerMessage.textContent = "";

  try {
    await api("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fullName: $("register-name").value,
        email: $("register-email").value,
        password: $("register-password").value,
        openingBalance: $("opening-balance").value,
      }),
    });

    registerForm.reset();
    showLogin("Account created successfully. Please sign in.");
  } catch (error) {
    registerMessage.textContent = error.message;
  }
});

depositForm.addEventListener("submit", (event) => {
  event.preventDefault();

  submitMoneyAction(
    `/api/users/${currentUser.id}/deposit`,
    {
      amount: $("deposit-amount").value,
      description: $("deposit-description").value,
    },
    "Deposit completed successfully!",
    depositForm,
  );
});

withdrawForm.addEventListener("submit", (event) => {
  event.preventDefault();

  submitMoneyAction(
    `/api/users/${currentUser.id}/withdraw`,
    {
      amount: $("withdraw-amount").value,
      description: $("withdraw-description").value,
    },
    "Withdrawal completed successfully!",
    withdrawForm,
  );
});

let verifiedRecipientEmail = "";

async function verifyRecipient() {
  const email = $("receiver-email").value.trim().toLowerCase();

  if (!email) {
    return;
  }

  actionMessage.textContent = "Checking recipient...";

  try {
    const data = await api(
      `/api/recipients?email=${encodeURIComponent(email)}`,
    );

    verifiedRecipientEmail = data.recipient.email;
    actionMessage.textContent = `Recipient confirmed: ${data.recipient.full_name}`;
  } catch (error) {
    verifiedRecipientEmail = "";
    actionMessage.textContent = error.message;
  }
}

$("receiver-email").addEventListener("blur", verifyRecipient);

transferForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const receiverEmail = $("receiver-email").value.trim().toLowerCase();

  if (receiverEmail !== verifiedRecipientEmail) {
    actionMessage.textContent =
      "Please enter and confirm a valid recipient email first.";
    return;
  }

  submitMoneyAction(
    "/api/transfers/email",
    {
      receiverEmail,
      amount: $("transfer-amount").value,
      description: $("transfer-description").value,
    },
    "Transfer completed successfully!",
    transferForm,
  );

  verifiedRecipientEmail = "";
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  actionMessage.textContent = "";

  try {
    await api("/api/me/password", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        currentPassword: $("current-password").value,
        newPassword: $("new-password").value,
      }),
    });

    passwordForm.reset();
    logout("Password changed successfully. Please sign in again.");
  } catch (error) {
    actionMessage.textContent = error.message;
  }
});

$("show-register-button").addEventListener("click", showRegister);
$("show-login-button").addEventListener("click", showLogin);
$("logout-button").addEventListener("click", () => logout());

loadDashboard();
