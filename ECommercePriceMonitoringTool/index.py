
import os
import logging
import smtplib
from email.mime.text import MIMEText

from flask import Flask, render_template, jsonify, request
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from webdriver_manager.chrome import ChromeDriverManager
from apscheduler.schedulers.background import BackgroundScheduler
import psycopg2
import time
import random
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv(dotenv_path="index.env")


app = Flask(__name__)
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Get database settings from environment
DB_NAME = os.getenv("DB_NAME")
DB_USER = os.getenv("DB_USER")
DB_PASS = os.getenv("DB_PASS")
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")

# Get email credentials from environment
EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASS = os.getenv("EMAIL_PASS")


def get_db_connection():
    return psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS,
        host=DB_HOST,
        port=DB_PORT
    )


def init_driver():
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--window-size=1920,1080")
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
    return driver


def send_email_alert(to_email, product_name, price, url):
    subject = f"🔔 Price Drop Alert: {product_name}"
    body = f"The price for '{product_name}' dropped to ${price}.\n\nCheck it here: {url}"
    
    msg = MIMEText(body)
    msg['Subject'] = subject
    msg['From'] = EMAIL_USER
    msg['To'] = to_email
    
    try:
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.starttls()
            server.login(EMAIL_USER, EMAIL_PASS)
            server.send_message(msg)
            logger.info(f"Alert sent to {to_email} for {product_name}")
    except Exception as e:
        logger.error(f" Failed to send email to {to_email}: {e}")


def scrape_amazon(product, driver, max_retries=3):
    wait = WebDriverWait(driver, 10)
    search_url = f"https://www.amazon.com/s?k={product.replace(' ', '+')}"
    
    attempt = 0
    while attempt < max_retries:
        try:
            driver.get(search_url)
            wait.until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, "div[data-component-type='s-search-result']")))
            results = driver.find_elements(By.CSS_SELECTOR, "div[data-component-type='s-search-result']")
            scraped_items = []
            
            for item in results:
                try:
                    title = item.find_element(By.CSS_SELECTOR, "h2 span").text.strip()
                    full_url = item.find_element(By.CSS_SELECTOR, "a.a-link-normal.s-link-style").get_attribute("href")
                    img_url = item.find_element(By.CSS_SELECTOR, "img.s-image").get_attribute("src")
                    
                    rating_text = item.find_element(By.CSS_SELECTOR, "span.a-icon-alt").get_attribute(
                        "innerText").strip()
                    rating_num = float(rating_text.split(' out of')[0])
                    rounded_rating = round(rating_num * 2) / 2
                    
                    try:
                        price_elem = item.find_element(By.CSS_SELECTOR, ".a-price > .a-offscreen")
                        price = price_elem.get_attribute("innerText").strip()
                    except Exception:
                        try:
                            whole = item.find_element(By.CLASS_NAME, "a-price-whole").text.strip().replace(",", "")
                            fraction = item.find_element(By.CLASS_NAME, "a-price-fraction").text.strip()
                            price = f"${whole}.{fraction}"
                        except Exception:
                            price = "N/A"
                    
                    if title and price and price != "N/A":
                        scraped_items.append({
                            "amazon_name": title,
                            "amazon_price": price,
                            "amazon_url": full_url,
                            "img_url": img_url,
                            "site_name": "amazon",
                            "amazon_rating": rounded_rating
                        })
                    if len(scraped_items) >= 5:
                        break
                
                except Exception as e:
                    logger.debug(f"Skipped a result due to error: {e}")
                    continue
            
            return scraped_items
        
        except TimeoutException as e:
            attempt += 1
            logger.warning(f"Timeout during scraping, attempt {attempt}/{max_retries}: {e}")
            time.sleep(3 + random.random() * 2)  # wait before retry
    
    logger.error(f"Failed to scrape Amazon after {max_retries} attempts for product: {product}")
    return []


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/scrape', methods=['GET'])
def scrape():
    product = request.args.get('product')
    if not product:
        return jsonify({"error": "Missing product input"}), 400
    
    driver = init_driver()
    try:
        amazon_data = scrape_amazon(product, driver)
    finally:
        driver.quit()
    
    if not amazon_data:
        return jsonify({"error": "No results found"}), 404
    
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM product WHERE name = %s", (product,))
        row = cur.fetchone()
        product_id = row[0] if row else None
        if not product_id:
            cur.execute("INSERT INTO product(name) VALUES (%s) RETURNING id", (product,))
            product_id = cur.fetchone()[0]
            conn.commit()
    except Exception as e:
        logger.error(f"DB error: {e}")
        return jsonify({"error": "Database error"}), 500
    
    for site_data in amazon_data:
        try:
            cur.execute("SELECT id FROM product_listing WHERE url = %s", (site_data['amazon_url'],))
            row = cur.fetchone()
            if row:
                listing_id = row[0]
            else:
                cur.execute("""
                    INSERT INTO product_listing(product_id, site_name, product_name, image_url, url, rating)
                    VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
                """, (
                    product_id,
                    site_data.get("site_name", "amazon"),
                    site_data.get("amazon_name", "N/A"),
                    site_data.get("img_url", "N/A"),
                    site_data.get("amazon_url", ""),
                    site_data.get("amazon_rating", None)
                ))
                listing_id = cur.fetchone()[0]
                conn.commit()
            
            price = site_data.get("amazon_price")
            if price is None or price == "N/A":
                price_val = None
            else:
                try:
                    price_val = float(price.replace("$", "").replace(",", "").strip())
                except ValueError:
                    price_val = None
            
            cur.execute("""
                INSERT INTO price_history(listing_id, price)
                VALUES (%s, %s)
            """, (listing_id, price_val))
            conn.commit()
            
            site_data['listing_id'] = listing_id
        
        except Exception as e:
            logger.warning(f"Insert failed: {e}")
            continue
    
    if cur:
        cur.close()
    if conn:
        conn.close()
    return jsonify({"amazon": amazon_data})


@app.route('/api/history', methods=['GET'])
def get_price_history():
    listing_id = request.args.get('listing_id')
    if not listing_id:
        return jsonify({"error": "Missing listing_id parameter"}), 400
    
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT scraped_at, price
            FROM price_history
            WHERE listing_id = %s
            ORDER BY scraped_at ASC
        """, (listing_id,))
        rows = cur.fetchall()
        prices = [{"date": r[0].isoformat(), "price": float(r[1]) if r[1] else None} for r in rows]
        return jsonify({"prices": prices})
    except Exception as e:
        logger.error(f"Error fetching price history: {e}")
        return jsonify({"error": "Internal server error"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@app.route('/set-threshold', methods=['POST'])
def set_threshold():
    data = request.get_json()
    product = data.get('product')
    threshold = data.get('threshold')
    email = data.get('email')
    
    if not product or not threshold or not email:
        return jsonify({'error': 'Missing data'}), 400
    
    try:
        threshold_val = float(threshold)
    except ValueError:
        return jsonify({'error': 'Invalid threshold value'}), 400
    
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO alert_thresholds (product_name, email, threshold_price)
            VALUES (%s, %s, %s)
        """, (product, email, threshold_val))
        conn.commit()
        return jsonify({'message': 'Threshold saved successfully'})
    except Exception as e:
        logger.error(f"Error saving threshold: {e}")
        return jsonify({'error': 'Database error'}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def scheduled_price_check():
    logger.info("=== Scheduled price check started ===")
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        alerts_to_send = []
        
        cur.execute("SELECT id, product_name, email, threshold_price FROM alert_thresholds")
        threshold_rows = cur.fetchall()
        
        cur.execute("SELECT name FROM product")
        products = [r[0] for r in cur.fetchall()]
        
        for product in products:
            driver = init_driver()
            try:
                items = scrape_amazon(product, driver)
                for itm in items:
                    cur.execute("SELECT id FROM product_listing WHERE url = %s", (itm['amazon_url'],))
                    row = cur.fetchone()
                    if row:
                        listing_id = row[0]
                    else:
                        cur.execute("""
                            INSERT INTO product_listing(product_id, site_name, product_name, image_url, url, rating)
                            VALUES (
                                (SELECT id FROM product WHERE name = %s),
                                %s, %s, %s, %s, %s
                            ) RETURNING id
                        """, (
                            product,
                            "amazon",
                            itm["amazon_name"],
                            itm["img_url"],
                            itm["amazon_url"],
                            itm["amazon_rating"]
                        ))
                        listing_id = cur.fetchone()[0]
                        conn.commit()
                    
                    price = itm.get("amazon_price")
                    if price is None or price == "N/A":
                        price_val = None
                    else:
                        try:
                            price_val = float(price.replace("$", "").replace(",", "").strip())
                        except ValueError:
                            price_val = None
                    
                    cur.execute("INSERT INTO price_history(listing_id, price) VALUES (%s, %s)",
                                (listing_id, price_val))
                    conn.commit()
                    
                    for t_id, t_product, t_email, t_threshold in threshold_rows:
                        if t_product.lower() in itm["amazon_name"].lower():
                            if price_val is not None and price_val <= float(t_threshold):
                                alerts_to_send.append({
                                    "email": t_email,
                                    "product": t_product,
                                    "price": price_val,
                                    "url": itm["amazon_url"]
                                })
            
            finally:
                driver.quit()
        
        for alert in alerts_to_send:
            send_email_alert(
                to_email=alert["email"],
                product_name=alert["product"],
                price=alert["price"],
                url=alert["url"]
            )
        
        logger.info("=== Scheduled price check complete ===")
    
    except Exception as ex:
        logger.error(f"Scheduled scrape failed: {ex}")
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# Start the scheduler
scheduler = BackgroundScheduler()
scheduler.add_job(scheduled_price_check, 'interval', hours=6)
scheduler.start()
logger.info("Scheduler started")

if __name__ == '__main__':
    app.run(debug=True, use_reloader=False)
