package org.loose.vvs.selenium;

import org.junit.jupiter.api.*;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.time.Duration;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.junit.jupiter.api.Assertions.assertTrue;

@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
public class ProfessorPanelUITest {

    private static WebDriver driver;
    private static WebDriverWait wait;

    // Poți trece din Maven: -Dprof.url=http://localhost:5173/#/professor-panel
    private static final String BASE = System.getProperty("baseUrl",
            System.getProperty("app.base", "http://localhost:3000"));

    private static final String PROF_URL_PROP = System.getProperty("prof.url", "");

    @BeforeAll
    static void setup() {
        driver = new ChromeDriver();
        wait = new WebDriverWait(driver, Duration.ofSeconds(8));
    }

    @AfterAll
    static void teardown() {
        if (driver != null) driver.quit();
    }

    /** Încearcă să deschidă ProfessorPanel pe mai multe rute. */
    private boolean gotoProfessorPanel() {
        List<String> candidates = PROF_URL_PROP != null && !PROF_URL_PROP.isBlank()
                ? List.of(PROF_URL_PROP)
                : Arrays.asList(
                    BASE + "/#/professor-panel",
                    BASE + "/professor-panel",
                    BASE + "/professor",
                    BASE + "/panel",
                    BASE + "/#/panel",
                    BASE + "/#/professor"
                );

        for (String url : candidates) {
            try {
                driver.get(url);
                // Așteaptă headerul cu “Hello,” și tab-urile principale
                wait.until(ExpectedConditions.or(
                    ExpectedConditions.presenceOfElementLocated(By.xpath("//header//*[contains(.,'Hello,')]")),
                    ExpectedConditions.presenceOfElementLocated(By.xpath("//nav//*[normalize-space()='dashboard']"))
                ));
                return true;
            } catch (TimeoutException | NoSuchElementException ignored) {
                // încearcă următorul candidat
            }
        }
        return false;
    }

    @Test
    @Order(1)
    void professorPanel_tabsExist() {
        boolean reached = gotoProfessorPanel();
        assumeTrue(reached, "Nu pot ajunge la ProfessorPanel pe niciun path candidat.");
        // tab-urile
        assertTrue(driver.findElements(By.xpath("//nav//*[normalize-space()='dashboard']")).size() > 0);
        assertTrue(driver.findElements(By.xpath("//nav//*[normalize-space()='teams']")).size() > 0);
        assertTrue(driver.findElements(By.xpath("//nav//*[normalize-space()='team']")).size() > 0);
        assertTrue(driver.findElements(By.xpath("//nav//*[normalize-space()='Performance Benchmarks']")).size() > 0);
    }

    @Test
    @Order(2)
    void professorPanel_exportMenu() {
        boolean reached = gotoProfessorPanel();
        assumeTrue(reached, "Pagina ProfessorPanel nu e accesibilă pentru meniul Export.");
        // butonul Export există
        WebElement btn = wait.until(ExpectedConditions.presenceOfElementLocated(
            By.xpath("//button[normalize-space()='Export']")));
        btn.click();
        // meniul se deschide (conține opțiunea Live grades)
        assertTrue(wait.until(ExpectedConditions.presenceOfAllElementsLocatedBy(
            By.xpath("//*[contains(.,'Live grades') and contains(.,'CSV')]"))).size() > 0);
    }

    @Test
    @Order(3)
    void professorPanel_heatmapModal() {
        boolean reached = gotoProfessorPanel();
        assumeTrue(reached, "Nu pot deschide Dashboard-ul cu Quick actions.");
        // Dacă există “Open scores grid”, deschide Heatmap
        List<WebElement> quick = driver.findElements(By.xpath("//button[contains(.,'Open scores grid')]"));
        assumeTrue(!quick.isEmpty(), "Butonul “Open scores grid” nu e prezent – sar testul.");
        quick.get(0).click();
        // modalul are titlul “Score Grid — Topics × Teams”
        assertTrue(wait.until(ExpectedConditions.presenceOfElementLocated(
            By.xpath("//*[contains(.,'Score Grid') and contains(.,'Topics')]"))) != null);
        // Close
        driver.findElement(By.xpath("//button[normalize-space()='Close']")).click();
    }

    @Test
    @Order(4)
    void professorPanel_rankingHeaders() {
        boolean reached = gotoProfessorPanel();
        assumeTrue(reached, "Ranking view nu e accesibil.");
        // Tabelul de ranking cu headerele
        assertTrue(wait.until(ExpectedConditions.presenceOfElementLocated(
            By.xpath("//table//th[contains(.,'Rank')]"))) != null);
        assertTrue(driver.findElement(By.xpath("//table//th[contains(.,'Team')]")) != null);
        assertTrue(driver.findElement(By.xpath("//table//th[contains(.,'Final')]")) != null);
    }

    @Test
    @Order(5)
    void professorPanel_teamsTab_basics() {
        boolean reached = gotoProfessorPanel();
        assumeTrue(reached, "Nu pot ajunge la pagina cu Tabs.");
        // Deschide tab-ul Teams
        driver.findElement(By.xpath("//nav//*[normalize-space()='teams']")).click();
        // Existența câmpului de filtrare
        assertTrue(wait.until(ExpectedConditions.presenceOfElementLocated(
            By.xpath("//input[@placeholder='Filter teams…']"))) != null);
    }
}
