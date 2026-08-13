<script lang="ts">
  interface Step {
    label: string;
    text: string;
  }

  let { steps }: { steps: Step[] } = $props();
  let index = $state(0);
  const step = $derived(steps[index]);
</script>

<figure class="stepper">
  <div class="display">
    <div class="label">
      {String(index + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
      {step.label}
    </div>
    <pre>{step.text}</pre>
  </div>
  <div class="controls">
    <button class="key" disabled={index === 0} onclick={() => (index -= 1)}>
      Back
    </button>
    <button
      class="key key--accent"
      disabled={index === steps.length - 1}
      onclick={() => (index += 1)}
    >
      Next
    </button>
  </div>
</figure>

<style>
  .stepper {
    display: grid;
    gap: 0.5rem;
  }

  .display pre {
    margin-top: 0.5rem;
    padding: 0;
    min-height: 4lh;
    white-space: pre-wrap;
    font-size: 0.875rem;
  }

  .controls {
    display: flex;
    gap: 0.25rem;
  }
</style>
