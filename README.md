# Dodge Ridge 滑雪路况看板

公开移动版包含 Santa Clara 往返 Dodge Ridge 的州公路地图、沿途城镇和山脚／山顶天气、Caltrans 通报和摄像头入口。天气和路况快照保存在访问者的浏览器里。

## 在 GitHub Pages 发布

将本目录文件放在公开仓库的 `main` 分支根目录。在仓库的 **Settings → Pages** 选择 **Deploy from a branch**，再选 `main` 和 `/(root)`。发布后用 Pages 设置页显示的 HTTPS 地址打开。站点支持项目仓库的子路径。

## 手动刷新

「刷新」在浏览器中重新请求 Open-Meteo、NWS 与 Caltrans 可用的公开数据。去程、回程分别按行车方向筛选主干公路通报并保存快照。回程页沿用同一走廊的地图范围，具体匝道和地方道路以导航为准。沿途城镇与 Dodge Ridge 山脚的 7 天对照表只统计当地 07:00–19:00 的天气和高低温。页面保留抓取时间，并在来源失败或记录过期时标明。CHP 事故和 NWS 雪水比无法由此页面跨站抓取，页面保留官方入口。沿途摄像头入口打开 Caltrans QuickMap 对应位置。

[Open-Meteo 天气数据](https://open-meteo.com/en/docs) 按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 提供，本页对数据做了分组和单位换算。地图底图由 [USGS National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map) 提供。道路数据来自 [Caltrans CWWP](https://dot.ca.gov/programs/traffic-operations/traveler-information/cwwp)，警报和部分预报来自 [NWS](https://www.weather.gov/documentation/services-web-api)。
