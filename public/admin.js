const token = localStorage.getItem("bankingToken");
const $ = (id) => document.getElementById(id);
const auditTable = $("audit-table");

let users = [];
let transactions = [];
let offset = 0;
const pageSize = 10;
let totalTransactions = 0;

const money = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
});

function cell(value) {
  const td = document.createElement("td");
  td.textContent = value;
  return td;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message);
  }

  return data;
}

function renderUsers() {
  const query = $("user-search").value.toLowerCase();

  $("users-table").innerHTML = "";

  users
    .filter((user) =>
      `${user.full_name} ${user.email}`.toLowerCase().includes(query),
    )
    .forEach((user) => {
      const row = document.createElement("tr");
      const role = cell(user.role);
      const status = cell(user.is_frozen ? "Frozen" : "Active");
      const actionCell = document.createElement("td");
      const actionButton = document.createElement("button");

      if (user.role === "admin") {
        role.className = "role-admin";
      }

      actionButton.textContent = user.is_frozen ? "Unfreeze" : "Freeze";
      actionButton.type = "button";

      actionButton.addEventListener("click", async () => {
        try {
          await api(`/api/admin/users/${user.id}/freeze`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              isFrozen: !user.is_frozen,
            }),
          });

          await loadDashboard();
        } catch (error) {
          $("message").textContent = error.message;
        }
      });

      actionCell.appendChild(actionButton);

      row.append(
        cell(user.id),
        cell(user.full_name),
        cell(user.email),
        cell(money.format(user.balance)),
        role,
        status,
        actionCell,
      );

      $("users-table").appendChild(row);
    });
}

function renderTransactions() {
  const filter = $("transaction-filter").value;

  $("transactions-table").innerHTML = "";

  transactions
    .filter(
      (transaction) =>
        filter === "all" || transaction.transaction_type === filter,
    )
    .forEach((transaction) => {
      const row = document.createElement("tr");

      row.append(
        cell(transaction.full_name),
        cell(transaction.transaction_type.replace("_", " ")),
        cell(money.format(transaction.amount)),
        cell(transaction.description),
        cell(new Date(transaction.created_at).toLocaleString()),
      );

      $("transactions-table").appendChild(row);
    });

  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(Math.ceil(totalTransactions / pageSize), 1);

  $("page-info").textContent = `Page ${currentPage} of ${totalPages}`;
  $("previous-button").disabled = offset === 0;
  $("next-button").disabled = offset + pageSize >= totalTransactions;
}

function renderAuditLogs(logs) {
  auditTable.innerHTML = "";

  logs.forEach((log) => {
    const row = document.createElement("tr");

    row.append(
      cell(log.admin_name),
      cell(log.target_name),
      cell(log.action.replace("_", " ")),
      cell(new Date(log.created_at).toLocaleString()),
    );

    auditTable.appendChild(row);
  });
}

async function loadTransactions() {
  const data = await api(
    `/api/admin/transactions?limit=${pageSize}&offset=${offset}`,
  );

  transactions = data.transactions;
  totalTransactions = data.totalTransactions;

  $("transaction-count").textContent = totalTransactions;

  renderTransactions();
}

async function loadDashboard() {
  if (!token) {
    location.href = "/";
    return;
  }

  try {
    const [usersData, auditData] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/audit-logs"),
    ]);

    users = usersData.users;
    $("user-count").textContent = usersData.userCount;
    $("message").textContent = "";

    renderUsers();
    renderAuditLogs(auditData.logs);
    await loadTransactions();
  } catch (error) {
    $("message").textContent = error.message;
  }
}

$("user-search").addEventListener("input", renderUsers);
$("transaction-filter").addEventListener("change", renderTransactions);

$("previous-button").addEventListener("click", async () => {
  offset = Math.max(offset - pageSize, 0);
  await loadTransactions();
});

$("next-button").addEventListener("click", async () => {
  offset += pageSize;
  await loadTransactions();
});

$("logout-button").addEventListener("click", () => {
  localStorage.removeItem("bankingToken");
  location.href = "/";
});

loadDashboard();
