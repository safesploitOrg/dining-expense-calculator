document.addEventListener("DOMContentLoaded", function() {
    const expenseForm = document.getElementById("expense-form");
    let expenses = loadExpensesFromLocalStorage();

    function initialize() {
        attachEventListeners();
        loadExpensesFromLocalStorage();
        updateExpenseList();
        setFooterYear();

        const clearButton = document.getElementById("clear-expenses");
        clearButton.addEventListener("click", clearExpenses);
    }

    function attachEventListeners() {
        expenseForm.addEventListener("submit", handleFormSubmit);
        window.addEventListener('beforeunload', handleBeforeUnload);
    }

    // Add the following function to enforce numeric input with a decimal point
    document.getElementById('item-cost').addEventListener('input', function(event) {
        // Remove non-numeric characters except decimal point
        this.value = this.value.replace(/[^0-9.]/g, '');
    });
    
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
    
        personExpenses.forEach((expense, index) => {
            const row = document.createElement("tr");
    
            const nameCell = document.createElement("td");
            nameCell.textContent = name;
    
            const costCell = document.createElement("td");
            costCell.textContent = `£${expense.itemCost.toFixed(2)}`;
    
            const serviceCharge = expense.itemCost * expense.serviceChargePercentage;
            const serviceChargeCell = document.createElement("td");
            serviceChargeCell.textContent = `£${serviceCharge.toFixed(2)}`;
    
            const totalCell = document.createElement("td");
            totalCell.textContent = `£${(expense.itemCost + serviceCharge).toFixed(2)}`;
    
            const descriptionCell = document.createElement("td");
            descriptionCell.textContent = expense.itemDescription;
    
            const deleteCell = document.createElement("td");
            const deleteButton = document.createElement("button");
            deleteButton.textContent = "X";
            deleteButton.className = "btn btn-sm btn-danger";
            deleteButton.addEventListener("click", () => {
                const confirmed = confirm(`Are you sure you want to delete this item for ${name}?`);
                if (confirmed) {
                    deleteExpense(name, index);
                }
            });            
            deleteCell.appendChild(deleteButton);
    
            row.appendChild(nameCell);
            row.appendChild(costCell);
            row.appendChild(serviceChargeCell);
            row.appendChild(totalCell);
            row.appendChild(descriptionCell);
            row.appendChild(deleteCell);
    
            expenseList.appendChild(row);
        });
    
        const totalRow = document.createElement("tr");
        const totalNameCell = document.createElement("td");
        totalNameCell.textContent = name + " Total:";
        totalNameCell.colSpan = 4;
    
        const personTotalCell = document.createElement("td");
        personTotalCell.textContent = `£${(totals.includingService || 0).toFixed(2)}`;
    
        totalRow.appendChild(totalNameCell);
        totalRow.appendChild(personTotalCell);
    
        expenseList.appendChild(totalRow);
    }

    function deleteExpense(name, index) {
        if (expenses[name]) {
            expenses[name].splice(index, 1);
            if (expenses[name].length === 0) {
                delete expenses[name];
            }
            saveExpensesToLocalStorage();
            updateExpenseList();
        }
    }
    

    const GBP = new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    
    // Update the total displays (in GBP)
    function updateTotalDisplays(totalBeforeService, totalService, totalIncludingService) {
        document.getElementById("total-expense").textContent = GBP.format(totalBeforeService);
        document.getElementById("total-service-charge").textContent = GBP.format(totalService);
        document.getElementById("total-expense-including-service").textContent = GBP.format(totalIncludingService);
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

    function setFooterYear() {
        const year = new Date().getFullYear();
        document.getElementById('year').textContent = year;
    }
    

    initialize();
});
