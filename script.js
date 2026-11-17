const menuButton = document.querySelector(".menu-toggle");
const navigationLinks = document.getElementById("primary-navigation");

if (menuButton && navigationLinks) {
    const closeMenu = () => {
        menuButton.setAttribute("aria-expanded", "false");
        navigationLinks.classList.remove("is-open");
    };

    menuButton.addEventListener("click", () => {
        const isExpanded = menuButton.getAttribute("aria-expanded") === "true";
        menuButton.setAttribute("aria-expanded", String(!isExpanded));
        navigationLinks.classList.toggle("is-open", !isExpanded);
    });

    navigationLinks.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", closeMenu);
    });

    document.addEventListener("click", (event) => {
        if (!navigationLinks.contains(event.target) && !menuButton.contains(event.target)) {
            closeMenu();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
            closeMenu();
            menuButton.focus();
        }
    });

    window.addEventListener("resize", () => {
        if (window.innerWidth > 900) {
            closeMenu();
        }
    });
}

const revealItems = document.querySelectorAll(".reveal, .reveal-left, .reveal-right");
if ("IntersectionObserver" in window && revealItems.length) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.18 });

    revealItems.forEach((item, index) => {
        item.style.transitionDelay = `${index * 80}ms`;
        revealObserver.observe(item);
    });
} else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
}

function makeWhatsAppUrl(message) {
    const whatsappUrl = new URL("https://wa.me/256707562610");
    whatsappUrl.searchParams.set("text", message);
    return whatsappUrl.toString();
}

async function submitStoredForm({ form, endpoint, note, whatsappLink, makeMessage }) {
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    payload.consent = formData.get("consent") === "on";
    const message = makeMessage(formData);
    submitButton.disabled = true;
    note.textContent = "Saving your details…";
    whatsappLink.hidden = true;

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "Your details could not be saved.");
        }

        note.textContent = "Your details have been saved. You can now choose to review and send a WhatsApp message.";
        whatsappLink.href = makeWhatsAppUrl(message);
        whatsappLink.textContent = "Continue to WhatsApp";
        whatsappLink.hidden = false;
        form.reset();
    } catch (error) {
        note.textContent = `${error.message} You can still contact the school directly on WhatsApp; your form was not saved.`;
        whatsappLink.href = makeWhatsAppUrl(message);
        whatsappLink.textContent = "Contact on WhatsApp without saving";
        whatsappLink.hidden = false;
    } finally {
        submitButton.disabled = false;
    }
}

const whatsappContactForm = document.getElementById("whatsapp-contact-form");
if (whatsappContactForm) {
    whatsappContactForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        submitStoredForm({
            form,
            endpoint: "/api/enquiries",
            note: document.getElementById("contact-form-note"),
            whatsappLink: document.getElementById("contact-whatsapp-link"),
            makeMessage: (data) => [
                "Hello Tumi Medical Institute,",
                `My name is ${data.get("name")}.`,
                `My phone or email is ${data.get("contact")}.`,
                `Enquiry: ${data.get("topic")}.`,
                `Message: ${data.get("message")}`,
            ].join("\n\n"),
        });
    });
}

const applicationForm = document.getElementById("application-form");
if (applicationForm) {
    applicationForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        submitStoredForm({
            form,
            endpoint: "/api/applications",
            note: document.getElementById("application-form-note"),
            whatsappLink: document.getElementById("application-whatsapp-link"),
            makeMessage: (data) => [
                "Hello Tumi Medical Institute,",
                "I submitted an application request on the website.",
                `Name: ${data.get("full_name")}.`,
                `Contact: ${data.get("contact")}.`,
                `Programme: ${data.get("programme")}.`,
            ].join("\n\n"),
        });
    });
}
