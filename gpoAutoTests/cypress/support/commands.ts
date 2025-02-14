/// <reference types="cypress" />

Cypress.Commands.add('openMainPage', () => {
    // cy.clearCookies()
    // cy.visit('https://staging.gpo.ca/')
    // cy.get('div[class="wp-block-button is-style-btn-more popmake-close pum-close"]').click;
    cy.visit('https://secure.gpo.ca/civicrm/contribute/transact?reset=1&id=23&action=preview')
   });


