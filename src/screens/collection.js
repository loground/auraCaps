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
        <div class="disc-face disc-front">
          <img src="/caps/${capNumber}.png" alt="Aura cap ${capNumber}" />
        </div>
        <div class="disc-face disc-back">
          <img src="/caps/back1.png" alt="Aura cap back" />
        </div>
      </div>
    `;
    grid.appendChild(card);
  }

  const backBtn = app.querySelector("#backBtn");
  backBtn.addEventListener("click", onBack);

  return () => {
    backBtn.removeEventListener("click", onBack);
  };
}
