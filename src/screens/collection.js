export function mountCollectionScreen({ app, onBack }) {
  app.innerHTML = `
    <div class="collection-screen">
      <button id="backBtn" class="back-btn" type="button">back</button>
      <h2>Collection</h2>
      <div class="collection-grid" id="collectionGrid"></div>
    </div>
  `;

  const grid = app.querySelector("#collectionGrid");
  for (let i = 0; i < 9; i += 1) {
    const capNumber = i + 1;
    const card = document.createElement("div");
    card.className = "collection-card";
    card.innerHTML = `
      <div class="disc-card" aria-label="Aura cap ${capNumber}">
        <img src="/caps/${capNumber}.png" alt="Aura cap ${capNumber}" />
      </div>
      <span>cap ${String(capNumber).padStart(2, "0")}</span>
    `;
    grid.appendChild(card);
  }

  const backBtn = app.querySelector("#backBtn");
  backBtn.addEventListener("click", onBack);

  return () => {
    backBtn.removeEventListener("click", onBack);
  };
}
