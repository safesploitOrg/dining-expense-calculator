document.addEventListener("DOMContentLoaded", function() {
    const expenseForm = document.getElementById("expense-form");
    let expenses = loadExpensesFromLocalStorage();

    function initialize() {
        attachEventListeners();
        loadExpensesFromLocalStorage();
        updateExpenseList();

        const clearButton = document.getElementById("clear-expenses");
        clearButton.addEventListener("click", clearExpenses);
    }

    function attachEventListeners() {
        expenseForm.addEventListener("submit", handleFormSubmit);
        window.addEventListener('beforeunload', handleBeforeUnload);
    }

    function handleFormSubmit(e) {
        e.preventDefault();
        const formData = getFormData();
        if (isValidExpense(formData)) {
            addExpense(formData);
            updateExpenseList();
            saveExpensesToLocalStorage();
            resetFormInputs();
        }
    }

    function clearExpenses() {
        if (confirm("Are you sure you want to clear all expenses? This action cannot be undone.")) {
            // Clear local storage and reset the expenses object
            localStorage.removeItem('expenses');
            expenses = {};
            // Update the UI to reflect the cleared expenses
            updateExpenseList();
        }
    }
    

    function getFormData() {
        return {
            name: document.getElementById("name").value,
            itemCost: parseFloat(document.getElementById("item-cost").value),
            itemDescription: document.getElementById("item-description").value,
            serviceChargePercentage: parseFloat(document.getElementById("service-charge").value) / 100
        };
    }

    function isValidExpense(expenseData) {
        return !isNaN(expenseData.itemCost) && expenseData.itemDescription.trim() !== "";
    }

    function addExpense(expenseData) {
        if (!expenses[expenseData.name]) {
            expenses[expenseData.name] = [];
        }
        expenses[expenseData.name].push(expenseData);
    }

    function resetFormInputs() {
        document.getElementById("item-cost").value = "";
        document.getElementById("item-description").value = "";
    }

    function updateExpenseList() {
        const expenseList = document.getElementById("expense-list");
        expenseList.innerHTML = "";
        let totalBeforeService = 0, totalService = 0, totalIncludingService = 0;

        Object.keys(expenses).forEach(name => {
            const personExpenses = expenses[name];
            const totals = calculatePersonTotals(personExpenses);
            totalBeforeService += totals.beforeService;
            totalService += totals.service;
            totalIncludingService += totals.includingService;
            appendExpensesToTable(name, personExpenses, totals);
        });

        updateTotalDisplays(totalBeforeService, totalService, totalIncludingService);
    }

    function calculatePersonTotals(personExpenses) {
        const totalBeforeService = personExpenses.reduce((sum, expense) => sum + expense.itemCost, 0);
        const totalService = personExpenses.reduce((sum, expense) => sum + (expense.itemCost * expense.serviceChargePercentage), 0);
        return {
            beforeService: totalBeforeService,
            service: totalService,
            includingService: totalBeforeService + totalService
        };
    }

    function appendExpensesToTable(name, personExpenses, totals) {
        const expenseList = document.getElementById("expense-list");
    
        personExpenses.forEach((expense) => {
            const row = document.createElement("tr");
    
            const nameCell = document.createElement("td");
            nameCell.textContent = name;
    
            const costCell = document.createElement("td");
            costCell.textContent = `£${expense.itemCost.toFixed(2)}`;
    
            const serviceChargeCell = document.createElement("td");
            const serviceCharge = expense.itemCost * expense.serviceChargePercentage;
            serviceChargeCell.textContent = `£${serviceCharge.toFixed(2)}`;
    
            const totalCell = document.createElement("td");
            totalCell.textContent = `£${(expense.itemCost + serviceCharge).toFixed(2)}`;
    
            const descriptionCell = document.createElement("td");
            descriptionCell.textContent = expense.itemDescription;
    
            row.appendChild(nameCell);
            row.appendChild(costCell);
            row.appendChild(serviceChargeCell);
            row.appendChild(totalCell);
            row.appendChild(descriptionCell);
    
            expenseList.appendChild(row);
        });
    
        // Append the total row for this person
        const totalRow = document.createElement("tr");
        const totalNameCell = document.createElement("td");
        totalNameCell.textContent = name + " Total:";
        totalNameCell.colSpan = 4;
    
        const personTotalCell = document.createElement("td");
        personTotalCell.textContent = `£${(totals.includingService || 0).toFixed(2)}`; //safety check
    
        totalRow.appendChild(totalNameCell);
        totalRow.appendChild(personTotalCell);
    
        expenseList.appendChild(totalRow);
    }    

    function updateTotalDisplays(totalBeforeService, totalService, totalIncludingService) {
        document.getElementById("total-expense").textContent = totalBeforeService.toFixed(2);
        document.getElementById("total-service-charge").textContent = totalService.toFixed(2);
        document.getElementById("total-expense-including-service").textContent = totalIncludingService.toFixed(2);
    }

    function saveExpensesToLocalStorage() {
        localStorage.setItem('expenses', JSON.stringify(expenses));
    }

    function loadExpensesFromLocalStorage() {
        const storedExpenses = localStorage.getItem('expenses');
        return storedExpenses ? JSON.parse(storedExpenses) : {};
    }

    function handleBeforeUnload(e) {
        e.preventDefault();
        e.returnValue = '';
    }

    initialize();
});
