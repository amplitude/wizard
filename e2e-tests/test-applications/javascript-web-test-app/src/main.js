const button = document.getElementById('tap');
let count = 0;
if (button) {
  button.addEventListener('click', () => {
    count += 1;
    button.textContent = `Tapped ${count}`;
  });
}
