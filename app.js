// script.js

// Initialisation de la carte
const map = L.map('map').setView([45.1, 5.8], 10); // Coordonnées à adapter

// Ajout du fond de carte
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Gestion des boutons
document.getElementById('zoom-in').addEventListener('click', () => {
  map.setZoom(map.getZoom() + 1);
});

document.getElementById('zoom-out').addEventListener('click', () => {
  map.setZoom(map.getZoom() - 1);
});

document.getElementById('reset-view').addEventListener('click', () => {
  map.setView([45.1, 5.8], 10); // Vue initiale
});
