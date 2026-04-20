function togglePopup(event, id) {
  event.stopPropagation();

  // close all popups
  document.querySelectorAll('[id^="day-"]').forEach(p => {
    if (p.id !== id) p.classList.add('hidden');
  });

  // toggle current
  const popup = document.getElementById(id);
  popup.classList.toggle('hidden');

  // position near clicked cell
  const rect = event.currentTarget.getBoundingClientRect();
  popup.style.top = rect.height + "px";
  popup.style.left = "0px";
}

// close on outside click
document.addEventListener('click', () => {
  document.querySelectorAll('[id^="day-"]').forEach(p => p.classList.add('hidden'));
});