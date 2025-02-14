import {mainPage} from '../pages/main.page'
describe ('Main page is open', ()=> {
    it('open app', function () {
        // cy.clearCookies()
        // mainPage.openPage();
        // mainPage.closePopUp()
        cy.openMainPage()
        mainPage.logoIsVisible()
    })

    it('join button in footer', function () {
        mainPage.join('helpotaki@rambler.ru','N2G 0C8')
        mainPage.subscriptionSuccessful()
    })
})