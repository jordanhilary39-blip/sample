const loginForm = document.getElementById("admin-login-form");
const passwordInput = document.getElementById("admin-password");
const logoutButton = document.getElementById("admin-logout");
const statusMessage = document.getElementById("admin-status");
const resultsSection = document.getElementById("admin-results");
const submissionsBody = document.getElementById("admin-submissions");
const resultCount = document.getElementById("admin-count");
const loadMoreButton = document.getElementById("admin-load-more");

let adminPassword = "";
let nextOffset = 0;
let totalSubmissions = 0;

function addCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value || "—";
    row.append(cell);
    return cell;
}

function renderSubmission(submission) {
    const row = document.createElement("tr");
    addCell(row, new Date(submission.submitted_at).toLocaleString());
    addCell(row, submission.type === "application" ? "Application request" : "Enquiry");
    addCell(row, `${submission.name}\n${submission.contact}`);

    const details = submission.type === "application"
        ? `${submission.programme}\nPrevious education: ${submission.qualification}`
        : submission.topic;
    addCell(row, details);
    addCell(row, submission.message);

    const actionCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.className = "page-button admin-delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteSubmission(submission, deleteButton));
    actionCell.append(deleteButton);
    row.append(actionCell);
    submissionsBody.append(row);
}

async function readResponse(response) {
    const result = await response.json();
    if (!response.ok) {
        throw new Error(result.error || "The administrator request failed.");
    }
    return result;
}

async function loadSubmissions(reset = false) {
    if (reset) {
        nextOffset = 0;
        submissionsBody.replaceChildren();
    }

    statusMessage.textContent = "Loading submissions…";
    const response = await fetch(`/api/admin/submissions?offset=${nextOffset}`, {
        headers: { Authorization: `Bearer ${adminPassword}` },
    });
    const result = await readResponse(response);
    result.submissions.forEach(renderSubmission);
    nextOffset += result.submissions.length;
    totalSubmissions = result.total;
    resultCount.textContent = `${totalSubmissions} submission${totalSubmissions === 1 ? "" : "s"}`;
    resultsSection.hidden = false;
    logoutButton.hidden = false;
    loadMoreButton.hidden = nextOffset >= totalSubmissions;
    statusMessage.textContent = totalSubmissions === 0 ? "There are no submissions yet." : "Submissions loaded.";
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    adminPassword = passwordInput.value;
    try {
        await loadSubmissions(true);
    } catch (error) {
        adminPassword = "";
        resultsSection.hidden = true;
        logoutButton.hidden = true;
        statusMessage.textContent = error.message;
    }
});

loadMoreButton.addEventListener("click", async () => {
    try {
        await loadSubmissions();
    } catch (error) {
        statusMessage.textContent = error.message;
    }
});

logoutButton.addEventListener("click", () => {
    adminPassword = "";
    passwordInput.value = "";
    nextOffset = 0;
    totalSubmissions = 0;
    submissionsBody.replaceChildren();
    resultsSection.hidden = true;
    logoutButton.hidden = true;
    loadMoreButton.hidden = true;
    statusMessage.textContent = "Submissions are locked.";
});

async function deleteSubmission(submission, button) {
    if (!window.confirm(`Permanently delete this ${submission.type}?`)) {
        return;
    }
    button.disabled = true;
    try {
        const response = await fetch(
            `/api/admin/submissions/${submission.type === "application" ? "applications" : "enquiries"}/${submission.id}`,
            {
                method: "DELETE",
                headers: { Authorization: `Bearer ${adminPassword}` },
            },
        );
        await readResponse(response);
        statusMessage.textContent = "Submission deleted.";
        await loadSubmissions(true);
    } catch (error) {
        button.disabled = false;
        statusMessage.textContent = error.message;
    }
}
