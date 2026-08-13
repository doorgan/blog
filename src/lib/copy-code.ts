for (const code of document.querySelectorAll("pre > code")) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "key code-copy-btn";
  button.textContent = "Copy";

  button.addEventListener("click", async () => {
    let result = "Copied";
    try {
      await navigator.clipboard.writeText(code.textContent ?? "");
    } catch {
      result = "Failed";
    }

    button.textContent = result;
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });

  code.parentElement?.append(button);
}
