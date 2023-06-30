from appium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from percy import percy_screenshot
import time
import os
import json

f = open('/Users/chris/automation-repo/org_auto/app_percy_ios_test/python-appium-app-browserstack/device_list.json')
data = json.load(f)
for item in data:
  selenium_version = "4.2"

  BROWSERSTACK_USERNAME = os.getenv("BROWSERSTACK_USERNAME")
  BROWSERSTACK_ACCESS_KEY = os.getenv("BROWSERSTACK_ACCESS_KEY")
  print(BROWSERSTACK_USERNAME)
  HUB_URL = "https://hub.browserstack.com/wd/hub"



  bstack_options = {
    "osVersion": item["osVersion"],
    "deviceName": item["deviceName"],
    "browserName": item["browserName"],
    "local": "false",
    "appiumVersion": "1.21.0",
    "buildName" : "percy on automate",
    "sessionName" :"python sdk test",
    "userName": 'username',
    "accessKey":'accesskey'
  }
  print(bstack_options)
  print(float(selenium_version))
  if(float(selenium_version) >= 4.0):
     options = Options()
     options.set_capability('bstack:options', bstack_options)
     driver = webdriver.Remote(
        command_executor=HUB_URL,
        options=options)
  else:
    driver = webdriver.Remote("https://{a}:{b}@hub-cloud.browserstack.com/wd/hub".format(a = "abelchristopherp_s37yKz", b = "vnaQD7dyBoreXuy4JDZq"), bstack_options)

  #driver.set_window_size(1280, 800)
  driver.get("https://percy-test-77543.web.app")
  time.sleep(2)
  maxH = driver.execute_script('return document.documentElement.scrollHeight;')
  time.sleep(2)
  idx, ptr = 0, 0
  status = False
  currH = driver.execute_script('return window.innerHeight;')
  command = 'window.scrollTo(0,{ptr})'.format(ptr=ptr)
  driver.execute_script(command)
  time.sleep(2)
  while ptr <= maxH:
      command = 'window.scrollTo(0,{ptr})'.format(ptr=ptr)
      driver.execute_script(command)
      time.sleep(2)
      ptr += currH
      idx += 1
      percy_screenshot(driver,
                       "exhaustive_test_poa_{osv}_{bv}_{bn}_{idx}".format(
                                                                                        osv=item["osVersion"],
                                                                                        bn=item["browserName"],
                                                                                        bv=item["deviceName"],
                                                                                        idx=idx))
      time.sleep(2)

  driver.quit()

