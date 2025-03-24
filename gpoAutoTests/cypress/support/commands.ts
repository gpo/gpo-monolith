/// <reference types="cypress" />

Cypress.Commands.add('openNewMembershipPage', () => {
    cy.visit('https://staging.secure.gpo.ca/civicrm/contribute/transact?reset=1&id=23&action=preview')
   });


