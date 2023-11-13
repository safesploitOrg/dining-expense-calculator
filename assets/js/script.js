document.addEventListener("DOMContentLoaded", function() {

    const expenseForm = document.getElementById("expense-form");
    const nameInput = document.getElementById("name");
    const itemCostInput = document.getElementById("item-cost");
    const itemDescriptionInput = document.getElementById("item-description");
    const serviceChargeInput = document.getElementById("service-charge");
    const expenseList = document.getElementById("expense-list");
    const totalExpense = document.getElementById("total-expense");
    const totalServiceCharge = document.getElementById("total-service-charge");
    const totalExpenseIncludingService = document.getElementById("total-expense-including-service");

    let expenses = {};
    let previousName = "";

    expenseForm.addEventListener("submit", function(e) {
        e.preventDefault();

        const name = nameInput.value;
        const itemCost = parseFloat(itemCostInput.value);
        const itemDescription = itemDescriptionInput.value;
        const serviceChargePercentage = parseFloat(serviceChargeInput.value) / 100;

        if (!isNaN(itemCost) && itemDescription.trim() !== "") {
            if (name !== previousName) {
                previousName = name;
            }

            if (!expenses[name]) {
                expenses[name] = [];
            }

            expenses[name].push({
                cost: itemCost,
                description: itemDescription,
                serviceChargePercentage
            });

            updateExpenseList();
            itemCostInput.value = "";
            itemDescriptionInput.value = "";
        }
    });

    function updateExpenseList() {
        expenseList.innerHTML = "";
        let totalBeforeService = 0;
        let totalService = 0;
        let totalIncludingService = 0;

        for (const name in expenses) {
            if (expenses.hasOwnProperty(name)) {
                const personExpenses = expenses[name];
                const personTotalBeforeService = personExpenses.reduce((sum, expense) => sum + expense.cost, 0);
                // (Continuation from where we left off)
                const personTotalService = personExpenses.reduce((sum, expense) => sum + (expense.cost * expense.serviceChargePercentage), 0);
                const personTotalIncludingService = personTotalBeforeService + personTotalService;

                totalBeforeService += personTotalBeforeService;
                totalService += personTotalService;
                totalIncludingService += personTotalIncludingService;

                personExpenses.forEach(expense => {
                    const row = document.createElement("tr");
                    const nameCell = document.createElement("td");
                    const costCell = document.createElement("td");
                    const serviceChargeCell = document.createElement("td");
                    const totalCell = document.createElement("td");
                    const descriptionCell = document.createElement("td");

                    nameCell.textContent = name;
                    costCell.textContent = expense.cost.toFixed(2);
                    serviceChargeCell.textContent = (expense.cost * expense.serviceChargePercentage).toFixed(2);
                    totalCell.textContent = (expense.cost + (expense.cost * expense.serviceChargePercentage)).toFixed(2);
                    descriptionCell.textContent = expense.description;

                    row.appendChild(nameCell);
                    row.appendChild(costCell);
                    row.appendChild(serviceChargeCell);
                    row.appendChild(totalCell);
                    row.appendChild(descriptionCell);

                    expenseList.appendChild(row);
                });

                // Append the total row for each person
                const totalRow = document.createElement("tr");
                const totalNameCell = document.createElement("td");
                const totalCostCell = document.createElement("td");
                const totalServiceChargeCell = document.createElement("td");
                const personTotalCell = document.createElement("td");

                totalNameCell.textContent = name + " Total:";
                totalNameCell.classList.add("bold-separator");
                totalCostCell.textContent = personTotalBeforeService.toFixed(2);
                totalCostCell.classList.add("bold-separator");
                totalServiceChargeCell.textContent = personTotalService.toFixed(2);
                totalServiceChargeCell.classList.add("bold-separator");
                personTotalCell.textContent = personTotalIncludingService.toFixed(2);
                personTotalCell.classList.add("bold-separator");

                totalRow.appendChild(totalNameCell);
                totalRow.appendChild(totalCostCell);
                totalRow.appendChild(totalServiceChargeCell);
                totalRow.appendChild(personTotalCell);

                expenseList.appendChild(totalRow);
            }
        }

        totalExpense.textContent = totalBeforeService.toFixed(2);
        totalServiceCharge.textContent = totalService.toFixed(2);
        totalExpenseIncludingService.textContent = totalIncludingService.toFixed(2);
    }
});
