 function renderStars(rating) {
      if (!rating || isNaN(rating)) return "N/A";
      const full = Math.floor(rating), half = (rating - full) >= 0.5 ? 1 : 0;
      return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - half);
    }

    document.getElementById('searchBtn').addEventListener('click', () => {
      const productInput = document.getElementById('productInput').value.trim();
      const errorDiv = document.getElementById('error');
      const resultsBody = document.getElementById('resultsBody');
      const resultsContainer = document.getElementById('resultsContainer');
      const table = document.getElementById('resultsTable');
      const spinner = document.getElementById('loadingSpinner');
      const exportButtons = document.getElementById('csvButtonContainer');

      errorDiv.textContent = "";
      resultsBody.innerHTML = "";
      resultsContainer.style.display = "none";
      table.style.display = "none";
      exportButtons.style.display = "none";

      if (!productInput) {
        errorDiv.textContent = "❗ Please enter a product name.";
        return;
      }

      document.getElementById('productInput').value = "";
      spinner.style.display = "block";

      fetch(`/scrape?product=${encodeURIComponent(productInput)}`)
        .then(res => res.json())
        .then(data => {
          spinner.style.display = "none";
          const items = data.amazon;

          if (!items || items.length === 0) {
            errorDiv.textContent = "❗ No results found.";
            return;
          }

          items.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
              <td><img src="${item.img_url}" style="height:100px;width:100px;"></td>
              <td>${item.amazon_name}</td>
              <td><a href="${item.amazon_url}" target="_blank" style="text-decoration:none;">amazon.ca</a></td>
              <td>${item.amazon_price}</td>
              <td data-rating="${item.amazon_rating}" style="color: #FFD700;">${renderStars(parseFloat(item.amazon_rating))}</td>
              <td><button class="btn btn-sm btn-danger show-history-btn" data-listing-id="${item.listing_id}">Show History</button></td>
              <td><button class="btn btn-sm btn-danger set-threshold-btn" data-name="${item.amazon_name}">Set Threshold</button></td>
            `;
            resultsBody.appendChild(row);
          });

          resultsContainer.style.display = "block";
          table.style.display = "table";
          exportButtons.style.display = "block";
        })
        .catch(err => {
          spinner.style.display = "none";
          errorDiv.textContent = `❗ ${err.message}`;
        });
    });

    // Show History (dummy version)
 document.getElementById('resultsBody').addEventListener('click', async event => {
  if (event.target.classList.contains('show-history-btn')) {
    const btn = event.target;
    const listingId = btn.getAttribute('data-listing-id');

    if (!listingId) {
      alert("Listing ID missing!");
      return;
    }

    const currentRow = btn.closest('tr');
    const nextRow = currentRow.nextElementSibling;

    // Toggle existing history row
    if (nextRow && nextRow.classList.contains('history-row')) {
      const isHidden = nextRow.style.display === 'none';
      nextRow.style.display = isHidden ? '' : 'none';
      btn.textContent = isHidden ? 'Hide History' : 'Show History';
      return;
    }

    // Create a new row to display history chart
    const historyRow = document.createElement('tr');
    historyRow.classList.add('history-row');
    const historyCell = document.createElement('td');
    historyCell.colSpan = 7; // Ensure it spans entire table
    historyCell.innerHTML = '<canvas style="width: 100%; max-height: 300px;"></canvas>';
    historyRow.appendChild(historyCell);

    currentRow.parentNode.insertBefore(historyRow, currentRow.nextSibling);
    btn.textContent = 'Hide History';

    try {
      const response = await fetch(`/api/history?listing_id=${listingId}`);

      if (!response.ok) throw new Error('Failed to load history data');

      const historyData = await response.json();
      if (!historyData.prices || historyData.prices.length === 0) {
        historyCell.innerHTML = '<p>No price history data available.</p>';
        return;
      }

      const ctx = historyCell.querySelector('canvas').getContext('2d');
      const labels = historyData.prices.map(p => new Date(p.date).toLocaleDateString());
      const data = historyData.prices.map(p => p.price);

      new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Price History',
            data: data,
            fill: false,
            borderColor: 'rgba(75, 192, 192, 1)',
            tension: 0.1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: false
            }
          }
        }
      });

    } catch (err) {
      console.error("History fetch error:", err);
      historyCell.innerHTML = `<p style="color: red;">Error loading price history: ${err.message}</p>`;
    }
  }
});



    // CSV Download
    document.getElementById("downloadCsvBtn").addEventListener("click", () => {
      const rows = document.querySelectorAll("#resultsTable tr");
      let csv = [];

      rows.forEach(row => {
        const cols = row.querySelectorAll("th, td");
        let rowData = [];
        cols.forEach((col, idx) => {
          if ([0, 5, 6].includes(idx)) return; // skip img, history, threshold
          let text = col.innerText.trim().replace(/"/g, '""');
          if (idx === 4) text = col.getAttribute("data-rating") || text;
          rowData.push(`"${text}"`);
        });
        if (rowData.length) csv.push(rowData.join(","));
      });

      const blob = new Blob([csv.join("\n")], { type: "text/csv" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "products.csv";
      link.click();
    });

    // PDF Download
    document.getElementById("downloadPdfBtn").addEventListener("click", () => {
      const table = document.getElementById("resultsTable");
      const rows = table.querySelectorAll("tr");
      rows.forEach(row => {
        row.querySelectorAll("td, th").forEach((cell, idx) => {
          if ([0, 5, 6].includes(idx)) cell.style.display = 'none';
        });
      });

      html2canvas(table).then(canvas => {
        const imgData = canvas.toDataURL('image/png');
        const pdf = new window.jspdf.jsPDF('l', 'mm', 'a4');
        const width = pdf.internal.pageSize.getWidth();
        const height = (canvas.height * width) / canvas.width;
        pdf.addImage(imgData, 'PNG', 10, 10, width - 20, height);
        pdf.save("products.pdf");

        rows.forEach(row => {
          row.querySelectorAll("td, th").forEach(cell => cell.style.display = '');
        });
      });
    });

    // Modal + Threshold Save
    document.addEventListener("DOMContentLoaded", () => {
      const modal = new bootstrap.Modal(document.getElementById("thresholdModal"));
      const productTitleEl = document.getElementById("productTitle");
      const thresholdInput = document.getElementById("thresholdInput");
      const emailInput = document.getElementById("emailInput");

      let currentProduct = null;

      document.addEventListener("click", e => {
        if (e.target.classList.contains("set-threshold-btn")) {
          currentProduct = e.target.dataset.name;
          productTitleEl.textContent = currentProduct;
          thresholdInput.value = "";
          emailInput.value = "";
          modal.show();
        }
      });

      document.getElementById("saveThresholdBtn").addEventListener("click", () => {
        const threshold = thresholdInput.value.trim();
        const email = emailInput.value.trim();
        if (!threshold || isNaN(threshold)) return alert("Enter a valid threshold.");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alert("Enter valid email.");

        fetch("/set-threshold", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product: currentProduct, threshold, email })
        })
        .then(res => res.json())
        .then(() => {
         alert("Alert saved. You'll get an email if the price drops!");
          modal.hide();
        })
        .catch(() => alert("Failed to save alert."));
      });
    });
//
//
//
//
//
//
//
//
////
////
////function renderStars(rating) {
////    if (!rating || isNaN(rating)) return "N/A";
////
////    const fullStars = Math.floor(rating);
////    const halfStar = (rating - fullStars) >= 0.5 ? 1 : 0;
////    const emptyStars = 5 - fullStars - halfStar;
////
////    return '★'.repeat(fullStars) + (halfStar ? '½' : '') + '☆'.repeat(emptyStars);
////}
////
////
////
////document.getElementById('searchBtn').addEventListener('click', function() {
////    const productName = document.getElementById('productInput');
////    const productInput = productName.value.trim();
////    const errorDiv = document.getElementById('error');
////    const tbody = document.getElementById('resultsBody');
////    const table = document.getElementById('resultsTable');
////    const spinner = document.getElementById('loadingSpinner');
//////    const csvContainer = document.getElementById('csvButtonContainer');
//////    const exportButtons = document.getElementById('exportButtons');
////const exportButtons = document.getElementById('csvButtonContainer');
////
////
////    // Clear previous error and results
////    errorDiv.textContent = "";
//////    tbody.innerHTML = "";
//////    table.style.display = "none";
////      resultsBody.innerHTML = "";
////  resultsContainer.style.display = "none";
////
////    if (!productInput) {
////        errorDiv.textContent = "❗ Please enter a product name.";
////        return;
////    }
////    // Clear input immediately after clicking search
////    productName.value = "";
////
////    // Show spinner while loading
////    spinner.style.display = "block";
////     exportButtons.style.display = "none";
////
////    fetch(/scrape?product=${encodeURIComponent(productInput)})
////        .then(response => {
////            if (!response.ok) {
////                return response.json().then(err => {
////                    throw new Error(err.error || "Something went wrong");
////                });
////            }
////            return response.json();
////        })
////        .then(data => {
////            spinner.style.display = "none";  // Hide spinner as soon as data arrives
////
////            const amazonData = data.amazon;
////            console.log(data.amazon);
////
////            if (!amazonData || amazonData.length === 0) {
////                errorDiv.textContent = "❗ No results found.";
////                table.style.display = "none";  // Hide table when no data
////                return;
////            }
////
////            // Clear any previous error message
////            errorDiv.textContent = "";
////
////            amazonData.forEach(item => {
////                const stars = renderStars(parseFloat(item.amazon_rating));
////                const row = document.createElement("tr");
////                row.innerHTML =
////                    <td><img src="${item.img_url}" alt="Product Image" style="height: 100px;width:100px;"></td>
////                    <td>${item.amazon_name}</td>
////                    <td><a href="${item.amazon_url}" target="_blank" rel="noopener noreferrer">amazon</a></td>
////                    <td>${item.amazon_price}</td>
////                    <td  data-rating="${item.amazon_rating}"  style="color: #FFD700;  font-size: 1.2em;">${stars}</td>
////                     <td><button class="btn btn-sm btn-danger show-history-btn"  data-listing-id="${item.listing_id}">Show History</button></td>
////                    <td> <button class="btn btn-sm btn-danger set-threshold-btn" data-name="${item.amazon_name}">Set Threshold</button></td>
////
////                ;
////                resultsBody.appendChild(row);
////            });
////
////            // Show table with results
////           resultsContainer.style.display = "block";
////
////        })
////        .catch(error => {
////            spinner.style.display = "none";  // Hide spinner on error
////
////            errorDiv.textContent = ❗ ${error.message};
////        });
////});
////
////
////
////
////document.getElementById('resultsBody').addEventListener('click', async function(event) {
////  if (event.target.classList.contains('show-history-btn')) {
////    const btn = event.target;
////    const listingId = btn.getAttribute('data-listing-id');  // get listing ID here
////
////    if (!listingId) {
////      alert("Listing ID missing!");
////      return;
////    }
////
////    const currentRow = btn.closest('tr');
////    const nextRow = currentRow.nextElementSibling;
////
////    // Toggle existing history row visibility if exists
////    if (nextRow && nextRow.classList.contains('history-row')) {
////      if (nextRow.style.display === 'none') {
////        nextRow.style.display = '';
////        btn.textContent = 'Hide History';
////      } else {
////        nextRow.style.display = 'none';
////        btn.textContent = 'Show History';
////      }
////      return;
////    }
////
////    // Create new history row
////    const historyRow = document.createElement('tr');
////    historyRow.classList.add('history-row');
////    const historyCell = document.createElement('td');
////    historyCell.colSpan = 6; // adjust as needed for full table width
////    historyCell.innerHTML = '<canvas style="width: 100%; max-height: 300px;"></canvas>';
////    historyRow.appendChild(historyCell);
////
////    currentRow.parentNode.insertBefore(historyRow, currentRow.nextSibling);
////    btn.textContent = 'Hide History';
////
////    try {
////      const response = await fetch(/api/history?listing_id=${listingId});
////
////      if (!response.ok) throw new Error('Failed to load history data');
////
////      const historyData = await response.json();
////
////      if (!historyData.prices || historyData.prices.length === 0) {
////        historyCell.innerHTML = '<p>No price history data available.</p>';
////        return;
////      }
////
////      const ctx = historyCell.querySelector('canvas').getContext('2d');
////      const labels = historyData.prices.map(p => new Date(p.date).toLocaleDateString());
////      const data = historyData.prices.map(p => p.price);
////
////      new Chart(ctx, {
////        type: 'line',
////        data: {
////          labels: labels,
////          datasets: [{
////            label: 'Price History',
////            data: data,
////            fill: false,
////            borderColor: 'rgba(75, 192, 192, 1)',
////            tension: 0.1
////          }]
////        },
////        options: {
////          scales: {
////            y: {
////              beginAtZero: false
////            }
////          }
////        }
////      });
////
////    } catch (err) {
////      historyCell.innerHTML = <p>Error loading price history: ${err.message}</p>;
////    }
////  }
////});
////
////
////// CSV Download
////document.getElementById("downloadCsvBtn").addEventListener("click", function () {
////    const rows = document.querySelectorAll("#resultsTable tr");
////    let csv = [];
////
//// rows.forEach(row => {
////    const cols = row.querySelectorAll("th, td");
////    let rowData = [];
////
////    cols.forEach((col, index) => {
////        if (index === 0 || index === 5 || index ===6) return; // skip image and history
////
////        let text = col.innerText.trim();
////
////        // Replace star symbols with numeric rating for rating column
////        // Suppose rating is in column 4 (index 4), adjust if needed
////        if (index === 4) {
////            // Try to find rating number from dataset or fallback
////            // Or you can parse stars back to number, but simpler to save raw rating somewhere visible
////
////            // If you have numeric rating stored somewhere, better to add a data attribute like data-rating to that cell.
////            // For example:
////            text = col.getAttribute('data-rating') || text; // fallback to existing text
////        }
////
////        // Escape quotes for CSV format
////        text = text.replace(/"/g, '""');
////        rowData.push("${text}");
////    });
////
////    if (rowData.length > 0) {
////        csv.push(rowData.join(","));
////    }
////});
////
////
////    const blob = new Blob([csv.join("\n")], { type: "text/csv;charset=utf-8;" });
////    const link = document.createElement("a");
////    link.href = URL.createObjectURL(blob);
////    link.download = "results.csv";
////    document.body.appendChild(link);
////    link.click();
////    document.body.removeChild(link);
////});
////
//////PDF Download
////
////document.getElementById('downloadPdfBtn').addEventListener('click', () => {
////  const table = document.getElementById('resultsTable');
////
////  // Temporarily hide the "Show History" column (index 5) and the image column (index 0)
////  const rows = table.querySelectorAll('tr');
////  rows.forEach(row => {
////    const cells = row.querySelectorAll('th, td');
////    if (cells[5]) cells[5].style.display = 'none';
////    if (cells[0]) cells[0].style.display = 'none';
////    if (cells[6]) cells[6].style.display = 'none';
////  });
////
////  html2canvas(table).then(canvas => {
////    const imgData = canvas.toDataURL('image/png');
////    const { jsPDF } = window.jspdf;
////    const pdf = new jsPDF('l', 'mm', 'a4');
////    const imgProps = pdf.getImageProperties(imgData);
////    const pdfWidth = pdf.internal.pageSize.getWidth();
////    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
////    pdf.addImage(imgData, 'PNG', 10, 10, pdfWidth - 20, pdfHeight);
////    pdf.save("products.pdf");
////
////    // Restore visibility of the columns
////    rows.forEach(row => {
////      const cells = row.querySelectorAll('th, td');
////      if (cells[5]) cells[5].style.display = '';
////      if (cells[0]) cells[0].style.display = '';
////      if (cells[6]) cells[6].style.display = '';
////    });
////  });
////});
////
////
////
////
////
////document.addEventListener("DOMContentLoaded", () => {
////  const modalElement = document.getElementById('thresholdModal');
////  const modal = new bootstrap.Modal(modalElement);
////  const productTitleEl = document.getElementById('productTitle');
////  const thresholdInput = document.getElementById('thresholdInput');
////  const emailInput = document.getElementById('emailInput');
////  const saveBtn = document.getElementById('saveThresholdBtn');
////  const closeBtnTop = document.getElementById('closeModalBtn');
////  const closeBtnFooter = document.getElementById('closeModalBtnFooter');
////
////  let currentProduct = null;
////
////  // Open modal when clicking set-threshold-btn buttons
////  document.addEventListener('click', (event) => {
////    if (event.target.classList.contains('set-threshold-btn')) {
////      currentProduct = event.target.getAttribute('data-name');
////      productTitleEl.textContent = currentProduct;
////      thresholdInput.value = '';
////      emailInput.value = '';
////      modal.show();
////    }
////  });
////
////  // Close modal buttons
////  closeBtnTop.addEventListener('click', () => modal.hide());
////  closeBtnFooter.addEventListener('click', () => modal.hide());
////
////  // Save button handler
////  saveBtn.addEventListener('click', () => {
////    const threshold = thresholdInput.value.trim();
////    const email = emailInput.value.trim();
////
////    if (!threshold || isNaN(threshold) || Number(threshold) <= 0) {
////      alert("Please enter a valid price threshold.");
////      return;
////    }
////    if (!validateEmail(email)) {
////      alert("Please enter a valid email address.");
////      return;
////    }
////
////    fetch('/set-threshold', {
////      method: 'POST',
////      headers: {'Content-Type': 'application/json'},
////      body: JSON.stringify({product: currentProduct, threshold:threshold, email:email})
////    })
////    .then(res => res.json())
////    .then(data => {
////      alert("Alert saved. You'll get an email if the price drops!");
////      modal.hide();
////    })
////    .catch(() => alert("Failed to save threshold"));
////  });
////
////  // Email validation helper
////  function validateEmail(email) {
////    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
////  }
////});
////
//
//
//
//// Helper to convert numeric rating (e.g., 4.5) into stars
////function renderStars(rating) {
////    if (!rating || isNaN(rating)) return "N/A";
////
////    const fullStars = Math.floor(rating);
////    const halfStar = (rating - fullStars) >= 0.5 ? 1 : 0;
////    const emptyStars = 5 - fullStars - halfStar;
////
////    return '★'.repeat(fullStars) + (halfStar ? '½' : '') + '☆'.repeat(emptyStars);
////}
////
////
////
////document.getElementById('searchBtn').addEventListener('click', function() {
////    const productName = document.getElementById('productInput');
////    const productInput = productName.value.trim();
////    const errorDiv = document.getElementById('error');
////    const tbody = document.getElementById('resultsBody');
////    const table = document.getElementById('resultsTable');
////    const spinner = document.getElementById('loadingSpinner');
////    const csvContainer = document.getElementById('csvButtonContainer');
////    const exportButtons = document.getElementById('exportButtons');
////
////    // Clear previous error and results
////    errorDiv.textContent = "";
////    tbody.innerHTML = "";
////    table.style.display = "none";
////
////    if (!productInput) {
////        errorDiv.textContent = "❗ Please enter a product name.";
////        return;
////    }
////    // Clear input immediately after clicking search
////    productName.value = "";
////
////    // Show spinner while loading
////    spinner.style.display = "block";
////
////    fetch(/scrape?product=${encodeURIComponent(productInput)})
////        .then(response => {
////            if (!response.ok) {
////                return response.json().then(err => {
////                    throw new Error(err.error || "Something went wrong");
////                });
////            }
////            return response.json();
////        })
////        .then(data => {
////            spinner.style.display = "none";  // Hide spinner as soon as data arrives
////
////            const amazonData = data.amazon;
////            console.log(data.amazon);
////
////            if (!amazonData || amazonData.length === 0) {
////                errorDiv.textContent = "❗ No results found.";
////                table.style.display = "none";  // Hide table when no data
////                return;
////            }
////
////            // Clear any previous error message
////            errorDiv.textContent = "";
////
////            amazonData.forEach(item => {
////                const stars = renderStars(parseFloat(item.amazon_rating));
////                const row = document.createElement("tr");
////                row.innerHTML =
////                    <td><img src="${item.img_url}" alt="Product Image" style="height: 100px;"></td>
////                    <td>${item.amazon_name}</td>
////                    <td><a href="${item.amazon_url}" target="_blank" rel="noopener noreferrer">amazon</a></td>
////                    <td>${item.amazon_price}</td>
////                    <td style="color: #FFD700;  font-size: 1.2em;">${stars}</td>
////                     <td><button class="btn btn-sm btn-danger show-history-btn"  data-listing-id="${item.listing_id}">Show History</button></td>
////                ;
////                tbody.appendChild(row);
////            });
////
////            // Show table with results
////            table.style.display = "table";
////            csvContainer.style.display = "block";
////            exportButtons.style.display = "block";
////
////        })
////        .catch(error => {
////            spinner.style.display = "none";  // Hide spinner on error
////            table.style.display = "none";    // Hide table on error
////            exportButtons.style.display = "none";
////            csvContainer.style.display = "none";
////            errorDiv.textContent = ❗ ${error.message};
////        });
////});
////
////
////
////
////document.getElementById('resultsBody').addEventListener('click', async function(event) {
////  if (event.target.classList.contains('show-history-btn')) {
////    const btn = event.target;
////    const listingId = btn.getAttribute('data-listing-id');  // get listing ID here
////
////    if (!listingId) {
////      alert("Listing ID missing!");
////      return;
////    }
////
////    const currentRow = btn.closest('tr');
////    const nextRow = currentRow.nextElementSibling;
////
////    // Toggle existing history row visibility if exists
////    if (nextRow && nextRow.classList.contains('history-row')) {
////      if (nextRow.style.display === 'none') {
////        nextRow.style.display = '';
////        btn.textContent = 'Hide History';
////      } else {
////        nextRow.style.display = 'none';
////        btn.textContent = 'Show History';
////      }
////      return;
////    }
////
////    // Create new history row
////    const historyRow = document.createElement('tr');
////    historyRow.classList.add('history-row');
////    const historyCell = document.createElement('td');
////    historyCell.colSpan = 6; // adjust as needed for full table width
////    historyCell.innerHTML = '<canvas style="width: 100%; max-height: 300px;"></canvas>';
////    historyRow.appendChild(historyCell);
////
////    currentRow.parentNode.insertBefore(historyRow, currentRow.nextSibling);
////    btn.textContent = 'Hide History';
////
////    try {
////      const response = await fetch(/api/history?listing_id=${listingId});
////
////      if (!response.ok) throw new Error('Failed to load history data');
////
////      const historyData = await response.json();
////
////      if (!historyData.prices || historyData.prices.length === 0) {
////        historyCell.innerHTML = '<p>No price history data available.</p>';
////        return;
////      }
////
////      const ctx = historyCell.querySelector('canvas').getContext('2d');
////      const labels = historyData.prices.map(p => new Date(p.date).toLocaleDateString());
////      const data = historyData.prices.map(p => p.price);
////
////      new Chart(ctx, {
////        type: 'line',
////        data: {
////          labels: labels,
////          datasets: [{
////            label: 'Price History',
////            data: data,
////            fill: false,
////            borderColor: 'rgba(75, 192, 192, 1)',
////            tension: 0.1
////          }]
////        },
////        options: {
////          scales: {
////            y: {
////              beginAtZero: false
////            }
////          }
////        }
////      });
////
////    } catch (err) {
////      historyCell.innerHTML = <p>Error loading price history: ${err.message}</p>;
////    }
////  }
////});
////
////
////// CSV Download
////document.getElementById("downloadCsvBtn").addEventListener("click", function () {
////    const rows = document.querySelectorAll("#resultsTable tr");
////    let csv = [];
////
////    rows.forEach(row => {
////        const cols = row.querySelectorAll("th, td");
////        let rowData = [];
////        cols.forEach(col => {
////            const text = col.innerText.replace(/"/g, '""');
////            rowData.push("${text}");
////        });
////        csv.push(rowData.join(","));
////    });
////
////    const blob = new Blob([csv.join("\n")], { type: "text/csv;charset=utf-8;" });
////    const link = document.createElement("a");
////    link.href = URL.createObjectURL(blob);
////    link.download = "results.csv";
////    document.body.appendChild(link);
////    link.click();
////    document.body.removeChild(link);
////});
////
//////PDF Download
////
////document.getElementById('downloadPdfBtn').addEventListener('click', () => {
////  const table = document.getElementById('resultsTable');
////
////  html2canvas(table).then(canvas => {
////    const imgData = canvas.toDataURL('image/png');
////    const { jsPDF } = window.jspdf;
////    const pdf = new jsPDF('l', 'mm', 'a4');
////    const imgProps = pdf.getImageProperties(imgData);
////    const pdfWidth = pdf.internal.pageSize.getWidth();
////    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
////    pdf.addImage(imgData, 'PNG', 10, 10, pdfWidth - 20, pdfHeight);
////    pdf.save("products.pdf");
////  });
////});














//// Helper to convert numeric rating (e.g., 4.5) into stars
//function renderStars(rating) {
//    if (!rating || isNaN(rating)) return "N/A";
//
//    const fullStars = Math.floor(rating);
//    const halfStar = (rating - fullStars) >= 0.5 ? 1 : 0;
//    const emptyStars = 5 - fullStars - halfStar;
//
//    return '★'.repeat(fullStars) + (halfStar ? '½' : '') + '☆'.repeat(emptyStars);
//}
//
//
//
//document.getElementById('searchBtn').addEventListener('click', function() {
//    const productName = document.getElementById('productInput');
//    const productInput = productName.value.trim();
//    const errorDiv = document.getElementById('error');
//    const tbody = document.getElementById('resultsBody');
//    const table = document.getElementById('resultsTable');
//    const spinner = document.getElementById('loadingSpinner');
////    const csvContainer = document.getElementById('csvButtonContainer');
////    const exportButtons = document.getElementById('exportButtons');
//const exportButtons = document.getElementById('csvButtonContainer');
//
//
//    // Clear previous error and results
//    errorDiv.textContent = "";
////    tbody.innerHTML = "";
////    table.style.display = "none";
//      resultsBody.innerHTML = "";
//  resultsContainer.style.display = "none";
//
//    if (!productInput) {
//        errorDiv.textContent = "❗ Please enter a product name.";
//        return;
//    }
//    // Clear input immediately after clicking search
//    productName.value = "";
//
//    // Show spinner while loading
//    spinner.style.display = "block";
//     exportButtons.style.display = "none";
//
//    fetch(/scrape?product=${encodeURIComponent(productInput)})
//        .then(response => {
//            if (!response.ok) {
//                return response.json().then(err => {
//                    throw new Error(err.error || "Something went wrong");
//                });
//            }
//            return response.json();
//        })
//        .then(data => {
//            spinner.style.display = "none";  // Hide spinner as soon as data arrives
//
//            const amazonData = data.amazon;
//            console.log(data.amazon);
//
//            if (!amazonData || amazonData.length === 0) {
//                errorDiv.textContent = "❗ No results found.";
//                table.style.display = "none";  // Hide table when no data
//                return;
//            }
//
//            // Clear any previous error message
//            errorDiv.textContent = "";
//
//            amazonData.forEach(item => {
//                const stars = renderStars(parseFloat(item.amazon_rating));
//                const row = document.createElement("tr");
//                row.innerHTML =
//                    <td><img src="${item.img_url}" alt="Product Image" style="height: 100px;width:100px;"></td>
//                    <td>${item.amazon_name}</td>
//                    <td><a href="${item.amazon_url}" target="_blank" rel="noopener noreferrer">amazon</a></td>
//                    <td>${item.amazon_price}</td>
//                    <td  data-rating="${item.amazon_rating}"  style="color: #FFD700;  font-size: 1.2em;">${stars}</td>
//                     <td><button class="btn btn-sm btn-danger show-history-btn"  data-listing-id="${item.listing_id}">Show History</button></td>
//                    <td> <button class="btn btn-sm btn-danger set-threshold-btn" data-name="${item.amazon_name}">Set Threshold</button></td>
//
//                ;
//                resultsBody.appendChild(row);
//            });
//
//            // Show table with results
//           resultsContainer.style.display = "block";
//
//        })
//        .catch(error => {
//            spinner.style.display = "none";  // Hide spinner on error
//
//            errorDiv.textContent = ❗ ${error.message};
//        });
//});
//
//
//
//
//document.getElementById('resultsBody').addEventListener('click', async function(event) {
//  if (event.target.classList.contains('show-history-btn')) {
//    const btn = event.target;
//    const listingId = btn.getAttribute('data-listing-id');  // get listing ID here
//
//    if (!listingId) {
//      alert("Listing ID missing!");
//      return;
//    }
//
//    const currentRow = btn.closest('tr');
//    const nextRow = currentRow.nextElementSibling;
//
//    // Toggle existing history row visibility if exists
//    if (nextRow && nextRow.classList.contains('history-row')) {
//      if (nextRow.style.display === 'none') {
//        nextRow.style.display = '';
//        btn.textContent = 'Hide History';
//      } else {
//        nextRow.style.display = 'none';
//        btn.textContent = 'Show History';
//      }
//      return;
//    }
//
//    // Create new history row
//    const historyRow = document.createElement('tr');
//    historyRow.classList.add('history-row');
//    const historyCell = document.createElement('td');
//    historyCell.colSpan = 6; // adjust as needed for full table width
//    historyCell.innerHTML = '<canvas style="width: 100%; max-height: 300px;"></canvas>';
//    historyRow.appendChild(historyCell);
//
//    currentRow.parentNode.insertBefore(historyRow, currentRow.nextSibling);
//    btn.textContent = 'Hide History';
//
//    try {
//      const response = await fetch(/api/history?listing_id=${listingId});
//
//      if (!response.ok) throw new Error('Failed to load history data');
//
//      const historyData = await response.json();
//
//      if (!historyData.prices || historyData.prices.length === 0) {
//        historyCell.innerHTML = '<p>No price history data available.</p>';
//        return;
//      }
//
//      const ctx = historyCell.querySelector('canvas').getContext('2d');
//      const labels = historyData.prices.map(p => new Date(p.date).toLocaleDateString());
//      const data = historyData.prices.map(p => p.price);
//
//      new Chart(ctx, {
//        type: 'line',
//        data: {
//          labels: labels,
//          datasets: [{
//            label: 'Price History',
//            data: data,
//            fill: false,
//            borderColor: 'rgba(75, 192, 192, 1)',
//            tension: 0.1
//          }]
//        },
//        options: {
//          scales: {
//            y: {
//              beginAtZero: false
//            }
//          }
//        }
//      });
//
//    } catch (err) {
//      historyCell.innerHTML = <p>Error loading price history: ${err.message}</p>;
//    }
//  }
//});
//
//
//// CSV Download
//document.getElementById("downloadCsvBtn").addEventListener("click", function () {
//    const rows = document.querySelectorAll("#resultsTable tr");
//    let csv = [];
//
// rows.forEach(row => {
//    const cols = row.querySelectorAll("th, td");
//    let rowData = [];
//
//    cols.forEach((col, index) => {
//        if (index === 0 || index === 5 || index ===6) return; // skip image and history
//
//        let text = col.innerText.trim();
//
//        // Replace star symbols with numeric rating for rating column
//        // Suppose rating is in column 4 (index 4), adjust if needed
//        if (index === 4) {
//            // Try to find rating number from dataset or fallback
//            // Or you can parse stars back to number, but simpler to save raw rating somewhere visible
//
//            // If you have numeric rating stored somewhere, better to add a data attribute like data-rating to that cell.
//            // For example:
//            text = col.getAttribute('data-rating') || text; // fallback to existing text
//        }
//
//        // Escape quotes for CSV format
//        text = text.replace(/"/g, '""');
//        rowData.push("${text}");
//    });
//
//    if (rowData.length > 0) {
//        csv.push(rowData.join(","));
//    }
//});
//
//
//    const blob = new Blob([csv.join("\n")], { type: "text/csv;charset=utf-8;" });
//    const link = document.createElement("a");
//    link.href = URL.createObjectURL(blob);
//    link.download = "results.csv";
//    document.body.appendChild(link);
//    link.click();
//    document.body.removeChild(link);
//});
//
////PDF Download
//
//document.getElementById('downloadPdfBtn').addEventListener('click', () => {
//  const table = document.getElementById('resultsTable');
//
//  // Temporarily hide the "Show History" column (index 5) and the image column (index 0)
//  const rows = table.querySelectorAll('tr');
//  rows.forEach(row => {
//    const cells = row.querySelectorAll('th, td');
//    if (cells[5]) cells[5].style.display = 'none';
//    if (cells[0]) cells[0].style.display = 'none';
//    if (cells[6]) cells[6].style.display = 'none';
//  });
//
//  html2canvas(table).then(canvas => {
//    const imgData = canvas.toDataURL('image/png');
//    const { jsPDF } = window.jspdf;
//    const pdf = new jsPDF('l', 'mm', 'a4');
//    const imgProps = pdf.getImageProperties(imgData);
//    const pdfWidth = pdf.internal.pageSize.getWidth();
//    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
//    pdf.addImage(imgData, 'PNG', 10, 10, pdfWidth - 20, pdfHeight);
//    pdf.save("products.pdf");
//
//    // Restore visibility of the columns
//    rows.forEach(row => {
//      const cells = row.querySelectorAll('th, td');
//      if (cells[5]) cells[5].style.display = '';
//      if (cells[0]) cells[0].style.display = '';
//      if (cells[6]) cells[6].style.display = '';
//    });
//  });
//});
//
//
//
//
//
//document.addEventListener("DOMContentLoaded", () => {
//  const modalElement = document.getElementById('thresholdModal');
//  const modal = new bootstrap.Modal(modalElement);
//  const productTitleEl = document.getElementById('productTitle');
//  const thresholdInput = document.getElementById('thresholdInput');
//  const emailInput = document.getElementById('emailInput');
//  const saveBtn = document.getElementById('saveThresholdBtn');
//  const closeBtnTop = document.getElementById('closeModalBtn');
//  const closeBtnFooter = document.getElementById('closeModalBtnFooter');
//
//  let currentProduct = null;
//
//  // Open modal when clicking set-threshold-btn buttons
//  document.addEventListener('click', (event) => {
//    if (event.target.classList.contains('set-threshold-btn')) {
//      currentProduct = event.target.getAttribute('data-name');
//      productTitleEl.textContent = currentProduct;
//      thresholdInput.value = '';
//      emailInput.value = '';
//      modal.show();
//    }
//  });
//
//  // Close modal buttons
//  closeBtnTop.addEventListener('click', () => modal.hide());
//  closeBtnFooter.addEventListener('click', () => modal.hide());
//
//  // Save button handler
//  saveBtn.addEventListener('click', () => {
//    const threshold = thresholdInput.value.trim();
//    const email = emailInput.value.trim();
//
//    if (!threshold || isNaN(threshold) || Number(threshold) <= 0) {
//      alert("Please enter a valid price threshold.");
//      return;
//    }
//    if (!validateEmail(email)) {
//      alert("Please enter a valid email address.");
//      return;
//    }
//
//    fetch('/set-threshold', {
//      method: 'POST',
//      headers: {'Content-Type': 'application/json'},
//      body: JSON.stringify({product: currentProduct, threshold:threshold, email:email})
//    })
//    .then(res => res.json())
//    .then(data => {
//      alert("Alert saved. You'll get an email if the price drops!");
//      modal.hide();
//    })
//    .catch(() => alert("Failed to save threshold"));
//  });
//
//  // Email validation helper
//  function validateEmail(email) {
//    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
//  }
//});