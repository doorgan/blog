const GAP = 12;

/** Pushes sidebar notes down just enough that they never overlap. */
function spaceNotes(notes: HTMLElement[]) {
  let previousBottom = -Infinity;

  for (const note of notes) {
    note.style.marginTop = "";
    if (getComputedStyle(note).position !== "absolute") continue;

    const { top, height } = note.getBoundingClientRect();
    const overlap = previousBottom + GAP - top;
    if (overlap > 0) note.style.marginTop = `${overlap}px`;
    previousBottom = Math.max(top, top + overlap) + height;
  }
}

export function mountAnnotations() {
  const annotations = [...document.querySelectorAll(".annotation")];
  const notes = annotations.map(
    (annotation) =>
      annotation.querySelector(".annotation-note") as HTMLElement,
  );

  const closeAll = () =>
    annotations.forEach((item) => item.classList.remove("is-open"));

  for (const annotation of annotations) {
    const mark = annotation.querySelector(".annotation-mark") as HTMLElement;

    const toggle = () => {
      const wasOpen = annotation.classList.contains("is-open");
      closeAll();
      annotation.classList.toggle("is-open", !wasOpen);
    };

    mark.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle();
    });
    mark.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
  }

  document.addEventListener("click", closeAll);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });

  const layout = () => spaceNotes(notes);
  layout();
  addEventListener("resize", layout);
  document.fonts?.ready.then(layout);
}
