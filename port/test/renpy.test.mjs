// Ren'Py compiled scripts (.rpyc) → .rpy: container, pickle reader (objects mode), statement printer and re_decode.
//
// Where the test data comes from:
// - REAL_82 and REAL_77 are real compiled scripts, unmodified: tutorial_playing.rpyc compiled by Ren'Py 8.2 and
//   tutorial_video.rpyc compiled by Ren'Py 7.7 (Python 2), both from the Ren'Py tutorial. Taken from the unrpyc
//   test cases (https://github.com/CensoredUsername/unrpyc, testcases/compiled, master and legacy branch). The
//   tutorial is part of the Ren'Py engine, MIT licence; unrpyc is MIT (Copyright (c) 2012-2024 Yuri K. Schlesner,
//   CensoredUsername, Jackmcbarn). EXPECTED_82 is unrpyc's own expected output for that file (testcases/expected,
//   without its "# Decompiled by unrpyc" footer); ORIGINAL_77 is the original tutorial_video.rpy with blank lines
//   and comments removed.
// - Everything else is STUB-BUILT, not written by Ren'Py: STUB_STMTS is pickled by the hand-written pickle writer in
//   helpers.mjs with class paths and attribute names copied from renpy/ast.py, renpy/atl.py and renpy/sl2/slast.py
//   (old-style ParameterInfo/ArgumentInfo as in 7.4 and older), and STUB_84 was made with Python's pickle module
//   (protocol 5) from stub classes shaped like Ren'Py 8.4+ (cslots state tuples, renpy.astsupport.PyExpr). Their
//   expected texts were checked by reading, not by a second decompiler.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { tempDir, py, pickleValue, buildPickle, buildRpyc } from './helpers.mjs';
import { unpickle, PyObj } from '../src/gamearchives.mjs';
import { readRpyc, decompileRpyc, printRenpyAst, splitLogicalLines, reconstructParaminfo } from '../src/renpy.mjs';
import { decodeTool } from '../src/godotbin.mjs';
import { archiveTool } from '../src/archive.mjs';
import { identify } from '../src/formats.mjs';

const unb64 = s => Buffer.from(s.replace(/\s+/g, ''), 'base64');

// ---------------------------------------------------------------- real files
const REAL_82 = unb64(`
UkVOUFkgUlBDMgEAAAAuAAAAkBEAAAIAAAC+EQAAmhMAAAAAAAAAAAAAAAAAAHhejVpnYBzVtTYYDBa92I4hwBA7SBBp3UIIEHCwaW5rYxtYCELM7l5pRpqd2XtnRuuFCBBg2ab33nuH9N57I/313nt/eXk17zvn3JnZNXpP+mHv7p2593yn
l6vr953Qc/oqB8yZM2dcmdiPQr3P+l9esnFOZS6WxlRb71s5EN/SMIhqY6qu51YW4GddDStjVH2o6ZpYDeF7ZGK9X60WBYGqJTgm7sE7bhokdb+W9Oj9a0ND1dQPEj8cGuoJ/Bhr83bqA7bqA9NBPb+vZlTYbJdcrK8LfTzsOXlSH1Se0Af3
VfYHwSqR14cM6kM73txu3DAejkyjRx+G1w/H60fI63ESGaWP9I4UzlwTug2lj6ochF/NqJk2h5qBW1P6aGbTTQK9IDs3CXq2uq01RK9HL8Sxiyb0O/r4PazpxZXF+DaC45YlKaj4bkBntf1wpGSabX3MhnlT+thKD4NwE9VQYRLrdw7q47oJ
bIJo/GZqmlGsevTxoHPChHb6vMUen3BiZR5OaLmmqYx+V5l1UE+NS6LVSyr74OdyvZTJNE2ElxJfxfrdg/qkvsp+WNyBc3Vvh6y2tM/b0TQ9uk9YWV5aoU8mUhvmJvqUSf0eyK6/j8kM+4FicQ14xzCBwA9VmDaqQFLaMK+yL9Fs62Ub5qZT
enl1Sq9gIe9ww5oXGb3Sy0ks16syEu+d1KeCxPv6PJzq4RhP9p+G/e9nxG1CfHqxeYU+I9t85qT+ADaftffms7F5NRNvW+If7CR+TrZ/zaRei/3n7r3/POw/X7FRKAhHxWT/sb5gUF/Ip8ZNYj3W6wb1epaEUeNRkLIONpT5lZpvagFe2egt
rRxiNTY0nIbsA3pTOa26lflkYqHfEOWV96RV0ZtrIOUEXqc3l1kELPUtMxjYRet/MfBztem6+bv0VivM/WW32pHobWUIdTuIkiabxoeBJm198YY53hbP7rwWOy/Jdnq84dJqh6VsdKsq6NEVmORlkNrlfd7msgfP+1Cnk25z2z36CrwyiFeu
FJtqeZEeYtNU+ioGgJWhYfi0dnczxJbnJrpa0fh6TuzEUUNFoXLwluO5sUNupOpOA67rJJ4bOq4zrFrOuB+nbuCE0bgK4n48UXju4l/DDdt4w01SqI52JM46B4pEAHLcIHDISbFOh4+rkq5xZGj5iTek6+JRfgjxu7VEq92sEjdJjF9NEyh0
uCx6MyOpuPBIuXI0FuDRzci4pj3U8bInxxlEv6qLOOWz94aITG6gRytHiYEFfs1Phvw6jvOHfXjT2J5CK9dDK4HVykGilUbVIwmHkHDU5w15V3nubq9aWY3Tzs+4Dvwx5cTuOMJPvxNEbp2/1CC9EXxzYNQI1CqsKUjODeuQuROFJd306mVP
7faGy95I2fPKnu+Nep1wJgFHWziHCBwjcGLASTrgvAo4m6HFaJhU44R+jbQH4rHjVqM0cbaqsHdL2/GtiuglRegU0EXjEEcsmpQDYlWoFKHdaUdpybksSp0aDCJuKvCAJeMkfkM5sFo4FfjkJdK3cBmoxElhUHK+PVZAlXQ6E+83gPdxy/th
wntLeN8B3tsdvNfA+6Ue4iUB6IVJ+iELQZBgjVG7NYifuJcHDuwpdaptx/gjXuLUYBZjxAOY9fyE2WEZxTW3qRyk4JK+eibINwLyNRbyEQL5wwJ5ApCv7YA8DMiZON0A5jAtusQzUTrisYtmmtUpgFrwaZIgUjrwOIJajfCzIe9BzTHUomBk
182E+iagvt6iPkpQT3ZGom1e1OrRN4CLG8HFTX3sVX4DVlDTO+WXgvBVqKfYtz23icS0a0rvLpcH9R7KBbTMctY3IxssoGx3y6S+FcfdlmWDBTYV3V51adsdib7TW1AuPHMnUN5lUS4QlHdXPUJ1D465t88DFCLDdYW+jwMdPFLp+6f0A3Ti
gwRk78rjIcBZSHAentSP4JxHMzgLLZzHBM7jiX6iC84U4Dxp4SwUOE91Cu1SBLge/TTgPYNjn5VygNKbfo5wUJhrIJT6YaCGE/08YCwiGC9M6hfx/ksZjEUWxstVlnPT9VHu6Vc65LILQF61QBYJkNfE5l7HQW902FzEbqJC9ohh38QJIgAi
b7dLsMP0Im7Hil2Wwhr+E2Ny1uZuQnlByhEkiziIEqfl0y56O/Oxkn5zJuPbDfgfsfAXC/yPCvyPAf7HO+DfDfgXhxxpI8o+NnwhotrQVo9UHPYmTuA3fPEIwUceIUwApQ1/WVBIY1XEtTGlmrnzUx53UuSIgOWFEFfz+NCmO8KBxmm5YVLS
n5iJwz3g8JOWw2OFw08Jh58Gh5/p4PBicNgpYKKW+Animo3qTBo5NWrFjABJFdWtAbPtJgesSHKOaIDfpmKmpD87E8ibAfJzFuRxAvLzAvILAPnFDpBVgNyO0ynLWbPA92gsdhCZEggZ0g9cGFW0t/XkSUHA8wGuxOJhg8DlFloq6S/NhPgW
IP6yRXyCIP6KIP4qEH+tA/H5QLyOahGEWaSkDupU9ljRuugiBshKrIFYm2q4Y1jJMqD++kyobgWqb1hUJwqqb0qU+hZQfXuvKPUdiVioDmL93Sn9PYo0358uTP0A8WEJxYe3JvUPcdCPsviwxMaHH0uY+kmif9oVpm4Dnp9ZPEsEz8+rHoWl
X8Mxv97ncTTitsaP4yhAvPwN0FpKtH5zUv8WXvrtjNZSS+t3ql5nALodJH7XklgqJH5PFPH72P0HHYooWdMp0i/rhIpOtteiSsqT1x/OJPA7QP2PLPWThPofC/U/AfU/7aD+GFPPE2NhCnVVo/IEWS6PJD56DreN0NKkZEv1cvYoHvObWK9F
YYI600koSiATIgZSxcNWxKWELIrJu/XRFME2jtIQK4009mvyYDyiMo2aGZTIJf1nMzF7J5j9c8tsnzD7F8LsX4LZv+pg9srpRZ2bPxVweSVEUIxC/Y6ySby24aKEogKpn+ohcuyMf6qajQpQDf31TGjvAtq/sWhPEbR/K77wd0D793v5wj+w
FXqmKe7wj1P6n8ii/3k6d/gXmGg/mei/Tupf4Kx/y0y035roL8Ud/j3R/9HlDncD0n9aSP0C6b/EHf4bx/zPdO7wK9AaAC0zBy3VpNkH/5cnzL74yIgOCFEzF2vdrnHP/F1mP6xaigNM0ezP70FrZp4cdgAflncWL+flLKnCzm+KmjXmcIto
WYVWRlSoDJkTNVRYC1C6Il+0IjNGimxz5VtFiQ4DjBr+1bBTKFSNowrINAnV8xSGjJVSiy3kOZlQYS+VMqrMGOnQ1ykyEIdQqfRL5kBicIY+5l4IYn4hiGUiiB4SREfLeyHcsMcchFXI5mCRzSEsm87azhyKpZ3mMHpeHjSH288j8JmYI4lI
3mPfB7JHFWRXCNmjWf6wQ7NAaCzMaBSlrFmEtaKaNe/Azymz2NI6hs5E3KT3a1xDmWNp6ZgNK8lS3smWcpwcfnyHpay0lnICISALNQ6jPpE2dxa79wP4uwrgKwX4EgYOazVL5ex389kcwqmwpYISrR5VlOYkwbOK8PQynj7Zc3IHnlUWzyl8
cGdQfwAA3lMAWCUA+vk9stwBOazEh+WWe3ZuuX4Y25bPdmHFvEDGCXa8wA1qVozVo5JZRkRnsKYHAW55Ae5UAbciB7dSwK3qBnd/Vv6u623AT7jZc7vGGv0YXFBRx3UVql+aXkifTP18XLIxsBe9FbKAk82XJJOgilFu7Adtp04x1EeSQHNJ
L0ppRolChiO9KEXdAK5Vx3Oqqs17Z8H0Q2D61ILp04Tp9+VMnyZMv7+b6Ruo9pGmnSCL7HmcRui8KCDOgLgVOmslpXHEly1JNDKCYMI7GxFSJLbkfTK3BvQEgxp0odM1oXnbYE6fBYMPg8EzCgZPFwbPzBn8gDB4VjeDlOjWQOYy5UYcREUX
QgkMjWTMku+niQt3xa2IWgSoCLMOHkWwhqUb4mFG1nPnPYw5exbgHwH41QX4MwX8B3Pw5wj4Nd3gaQqQF/xEkOqHTKAifcRdqilQgWIKTVO5OkYaLc9HMyK1aZHF6+MYvyL2IxPQwIe9yrZrJbN2Fkw8CibOLZg4S5g4L2fifGHigm4mmrbU
uKi0jZosKiYuKm2k4l4soxgAocCHwANlK6SW2yZPIzZs7W/LJYeGlfBEfsxtAjsO93DuCEqTkrlwFuw8BnbWFeysFnbW5+xsEHY2drNzO9jZwkNoaxu9cS+Nf5g8tGFL09hDxwt4KJvH2LrEZdIm40XZKONQ211wxYu3W6oao0lCCqc29hr3
LC9JmvEZy5a1Wq2S3L1EZmQi/3bNMneiZDbNgtnHwWy5YPYcYXZzzuwWYfaibmYDqzt4Bi5R2pnpgSmuf8Ft9gSM5N7kDNCLxWCNing00k42eM0MFO6W0tAY7lhVCbJkyWydBStPgJVtBStrhZXtOSsXCyuXdLNyEoX3KA14MCnypZmzQisq
A9AM3WpzaQZiT8fklZM93KymDA3Pu8awTwLRZQWiC4CochjNl7KrpSFuw83leGeU4AHvhwhvR3GzCUVUj7kCq0ifg8LClcQCE4ZRNGIzhN+D5ipepXnRZegKjIuf/Gu7SZWp8is1/N9x9vq00ewxdTlbydnDfApVKIA2ohIzQuccQb+zC7NM
IsajRzSSKu5fjI+1PZWDsTgSRFVcrwV0IWFG6VUszjFjJJC81HoaIgoKEW0QpTVICO4uE9IuupwoI8VHJCXho0lfLW4tuA3hHmWwC6cDO1RH125i2sgQRwnRaDeYZwAmKcBsFjCpBTOOT8VoYoilRWRRcXAFhVZ0CPNeuiEyO/BgN+bylUOt
fobyWwjTZvRXE9RyWfHYPpfEUyB+TUH8PBAf7TSMDxMMxRr1UCOZCeLC21I5vJNbe5dpri0Omi9cXEfbPVwLmetFYJOEQi6HzA38nQq0G+XhTbyQF2jPklHZebgfjkcceTMzeFt6712DW5ReGxQQ5Gr0ZhYWGxG5fMtTKkDU46oB5UEzjfOk
yvOntMmzc2c7IjhNFasm6y/oiibrN9Hzjfs4MOv7zU7ie4Yy8FkIeqqQz3aRzy6WD4lgt4hgT7cI6NZLLguQUlwaOnRSLq4LiFca/HDapUru/+Seqifm/23Mc11F7JubZ8HPc+DnloKfS4SfW3N+bhN+bu/m5xXws9XqJYOb1TCu3BPwYJbT
rMxz6crG49EDhcq6j5saSrhU/pScNTayw81QKNGdHac5Kp8gsIGiBs7NJm7HiF57zSVtVq/7w3zzhQsWplgyd8xCEs9DEncWkqiIJO7KJXG3SOKebknQnC8z7gTJDO0xXe9Y2Yi52QsVkgPzLDMOvpLjPx5westRb8ncOwuQLwDkfQXIywXk
/TnIBwTkg90gz81KPocBSUFOkqdhE5UdMra1HiVGR07EU5nC5UrmoVlAfBEQHy4gXiEQH2GI1P8+KhAfY4hdVznmcazx1SsmXUiJoaqbJ7A0ZZ6kPehcn7KfT+MzMc8Qlc4O9iWQfrYgfaWQfi6XzvNC+oVu6RxPzqkCNCF0s0zWORLZwbZo
dLV5cRZ8vwziLxXErxLiL+fEXxHir3YTpwQI+zEoOWPk3ddmQegVEHq9IFQVQm/khN4UQh95O6FNuBOl20bUsh+dBaFXQehjBaG6EPp4rslPCKFPTqPJT5Em83s582nW4mes9j5rPz/HWvz83lp8DWS/UJAdFrJfJLJqNEtc09cUXyq2bZVt
X2a0lLm+Imi/ymglc32Nv1PY/ro8/Ea3zN6SPi+fUNn5PM0rKbDVyF5Qo6LQG4iGB7jexkA7zUpteydvPV3u6bOxw3CE6Rg0QSFyr1tsNFrUAOMSCH/H4LPG+M8jjPRd9FcOxqd7fR62UWNfo6taoLJ/AIH8GPIW2tr1JxQl881Z6P11KOBb
hSRHRZLfJkl21H9beXjbY76DdUjwuyLB75EEuUjquC58Awd+vzgwkAN/0K3R/6fweqvY68neH9LeUUv6R0L6x9ORfhOkf/K27T9l0lPmZ/gs/S/0egOqeF6NWndgHMXVNx2LXmwChLAEBwlinSWdigUBB1ON8WGMgYNgxO7enHalvd2b2V2d
D2JAFNmm9957h/TeeyOV9N57DyHJ9335fm/e7u3pOJU/bN3N7cz8fr958+a9N3vptpvkgq7iTgsWLJgQKnQDX25zyitnnbqguB2axkVdblvcGZ9i3wvscVGS2xUX4WtJlIVSojRSNVUoRvA5UKHc3rYDzxN2hGHCDjxjxl5Ucu2oQ+5gj4xY
setFrj8y0uG5Idp2vFLutE7uHG+QC7tsJfxqPWeifZXv4seOwyflLoVNcteu4g6Y0KLp5W4b5O5NT65Xph+WA1XpkHvg8T3x+F78eBgFSsi9nb2Zmal8syLkPsVd8K0aVOPqSNUzbSH31TTNyJOL0nEjr2OdWVtJ83XIxRh2v03yNV36ObTJ
/Yv749MohlsWxZjFNT0aq+76ozlVrcsDVu84JQ8sdmgQZiQqwo9C+doN8qDpE6yBNG41VtUgFB3ydZjn4E3S6HL2d/QIhxR3xAg1U1WFkq8v6DUoxcokaeWhxW3wtUcu0dNUVYCHIleE8g0b5GFdxe3RuBHjys4mrdbWT9hYVR2yi6n05Hrl
4TTV6u0iecSkfCO0W9qlpym7ntBydTsH6Ak81xd+XLGAJLd6x+K2NGddLlu9XTwle6wp2atF3mj6thMo2ec0puiR+XSK/kk5gCkGuxyM6mAYh/sPof9yjbhOiIezzr3yyLTzUZPyTeh8dGvnY9B5hZ68nkz+5ubJj037r5yUx6H/8a39T0D/
E4U2CgFxREj2H8qTNsiT9ahhlaiHctUGeYpWQomJwIv1Gqwu6EdsV9keHjnVWVLcLVmxkXLs6z0g1xRiyywuJBPz3QovXmFrbPG6mQoqR9h18rSClkCrvnYOAzv9lJe7XxJrLlm4Wa5LxNyBe4uNkTyjAFHXY1JayapyYaBRXZ65eoGz1kl6
XoyeZ6U9Hd3hbKvJUk41LeF1yCJM8hyodm6Xc1rBwc57S/Mm1VvPg32fYdY75Hl4dgOePb9LM3NLMHq37MJgRjSb1p0y0je8fMC0lg/KC1gdDzL4GE2abOqe6Y/G5qiQVkGba80JpK2tXsiSfgItI2W4Cym2aPY1x4xkuSjx8djQCIOKCHxh
4CnDMUODdqgoGRV4BSNyTN8wjbKoGRNuGJue4QcTwguX4heB3038q5h+HU+YUQyroB6RscqAjcC3GabnGbT/0U6DT4icHNVOp+ZGzoh0mIHrg5JpR9LdojUxo0i5VhzBVsYKTFqNxuwdxgvFfUklUakGylT1kaaHPR5OwbFaJlxgRTsGH07P
9KRf3Idt13NtNxpp0j3Ymi34pVjwarLgu/CCS8uhNVNYs7DLmWGRbLN/aHDYsiT4Fxyr4NhOyRFbnHJxBWY9MVXHc8eFEZoT8IBLDS8wS/qDDZVH8cnAvsJZIXxbQGHTL2FtjMDPydhxCo67xRkrOOMFxys4Fcd3mmFPAvZEAns3hl1j2BsB
uz4j7HK+p9w7PDQsL2yF/QxgnwarCMq01Ibv2mQNABkaphXEkbFO+J1r64abLDk9JIiFAItgAvKGbBk8QCgyE8EpZNSDOGecE8SGDQMLqwJc0aSMyK0IAxsM+x966CayH1bDE5ERw0B5/GRYBpWTF82l0WXQ6K2JRnuwRptYo4uh0SUzamSW
zaH+vBiSl7ZqZEOjsx0cAQS0E1vB9bVYjBhtmp1pYzlJJf7BgB3HhlU3lDvqRIYNcxwnrhDFcSNNW2sZ2mZVGIgqcnJyLmqXg9plCbW9mNrlTO0KULtyRmq95qC9vG94UE61UiuDWro8pgczbMsiclQQjzrahaSWImMQSkjGUYRDwoBHIEpW
gK8Vfg5mE2KZBYx781zsrgC7LQm7fZjd1mYnfIYT1DrkVWB7Ndhe06V3vVuBVdnyWv4msEjCl9dp3+OYVZzJ10/JGwqFDfJGOgapWa+HvAkH4SI66G+elLdguFvTg3BRcgrfZpnU7fZI3uEsKmSe40qgvDNBuYhR3mU5hOpuDHNPlwMoNI0O
qeS92hHDEwh535S8n0Z8gIC0Bl0PAs5igvPQpHwY4zySwlmcwHmU4TwWycenwZkCnCcSOIsZzpPNop0NB9whnwK8pzHsMxwJ0ckunyUc5IYrcPWu74lyJJ8DjP0IxvOT8gU8/7YUxn4JjLdbWueq6SLSle9o0mUzgLwzAbIfA3kX2+a7MdB7
ZrTN5fnBnr6+flO+t9U2A73thK93WNlVYQTPgxNk+hbTG7AT508otKsgt4v/2OiM4xrbjs43jthw6IVeEBk1l3rR0+mezcn3zWWkW0Dz/QnN/ZnmB5jmB0HzQzPSFCVh9vaXy/LDrTRvAs0zfX1iBHTaJu4VJ0PiekuBCP3OyPDciss7jHnQ
DmOyYJO459QZxaHI/O64ENWG06GQyIgRi3haV7hg29GDVhFb6Kaa6Uc5+ZG5lNgKJT6aKHEgK/ExVuLjUOITMyox3NNjizyc0SdblTgTSjQvGKGK3Ah+NzmdNETEGkEt1EgRbCChUBClXtUONeAzlldUP03xY05+ai4yV4HMpxMyBzGZzzCZ
z4LM52Y+WIXZM2APWvLzrWQskFkPFHT6J+aIz8F4aMBzRlg0rKZnwpiDVqttHIJMUg9g8plSVnCsZrbqOfmFuZhdDWZfTJgdzMy+xMxeBLMvz7wvxZBYnjeXy6+0MjsRzFZRzIfjAkd1E0oKL5OlMpEIdpN1JoaZ2HLFHEdLGhnIr86F/hqg
/1qC/hBG/3X2tt8A+pdavO032fMiugrlt6bkt8ljfqedu/0u/Nyh5Oe+Nym/j4F+kPq5QxM/90N2tz+K5I+nudtrgecnCZ5DGc9PLYfc688wzM+7HO1VdWbqhmHgwe//AnMtobl+OSl/hYd+nc61JJnrN5bT7EivwxS/TaZYwlP8jhfs9+j9
hxkXrN/q6y33DPXKP7YuWC4xxSws0WtHSYDeJ1k02jis/zTXwlwPlH9OUB7GKP/CKP8KlH+b2Q+apr3cMofl31tR3qtRNgKGzLRKwqYwEKd/wyO6SEPNOlxklYIQynPSn8Jxt4p2O/Aj5AdGRN4OEQJ8PkWW2ip1KMaNvNXM0liMwyUMYh8t
lTh0bf5hIqBwmPJbpDY5+Y+5RLkBoryciNLFovyTRXkFovxrRlGs3oHBPjPfL//dKsr57Zeuse0ooG5EnARZCeRnCE/Zq1RMhKoUiC6luJMcT6oTZaNKeIg6/zMXqxvB6n8SVkcwq//lPfh/YPXf6XtQLUBGqjeAo6p6J6pt0DKltsX/2FJq
O/xtsyXV9tR+wOql2ClqB3yeVDtSj01qJ/xJt8xS3jJqZ7TpHaoW4lOkOqhzc5R208LNahdq5NLKUg1b7UrdaLeq3Xjs3fXYr9qzag8G001g9tRg9uIOezeB6U7A7KNHbd7CN2P2fbPZu3n2Rfo5WINazIPtpwebIdMcGu4pD5fsIfUaGqgl
2XyqkZHQKidVxSztCPVJg4PCwoKPCl8osmjKxdHmIfvAkVoL1DjZSF0nLxayMeyBoOJeiK0CWxETCLxSI4FV6dog7Rc6fZOcTZ+3lMNxsoMEIERk4coYh7Q+FTipy6n9icIcqe0t0OyATLNlrNmBpFlTIeZkeIIO9Vq0QsaDWMbXaRmbw251
MJquVEZicockf1+vbeVQmqRR+bkV0y7Jpu3lad+glwomrg7jOTrTObIsQ3WhLUs01OH4OqWOSOZ6I42Jo4Cet3XYqpayUfWRUXVro8rx4MuajKovMaoeQqAtvFej7qPOzRZ+G4DnM+B9DLxfAycLH+CxB/XY2sIp56BYH1k9BftqiPHkCc9y
jWeY+xzZhCef4DlKD9xs5LcDwJsyAHkGcLR+joz8GB5shR5sBiO3bFS9+vqEejMN1GLkxzSM3PXDpBCQ5NxZVYqLVkkRS5ct0hC4FOTUsTTsHIZ3B3iszHgMMI/jGjyOZx4nzMajZGOz2uUhdWIbHrelecyqzgp2n64CmNPqbEtRSaOoWwe0
SGOonMaFFiochbnEaXcimcbxZqS1VD4iERYKM3S9ulEip+/i9EPVgR7kmJhOQK7WdSJXMD1s2BJ+p/RInTQPfe6EPidn+gyxPqsa+pzC+qyeTZ/hfHnIWl4eVqe20ecyiie5QETseEV1lZmIOIFHIoBczTeO42Ndn2bcJQpGR+HNdM9KgDAB
XRq1Fp0O0i8oMqJC0a5A0UgV1Zp5aHEXtChkWgyzFqc1tFjLWpw+q63kBwbyZeRv69poQef9Sqwk3xPBZyOg9rG0mgWtnF7PpVQw1MWVWkCZIRYeJThdIdN2w8myrrGlpZtGiqvOmAfPu8FzfcbzKOZ5ZoPnWczz7Nl4lu0e27R78opq1O3q
To1Uj7BRZJYuE68pjhOK1pAr4MqH6tQlFNtqjot0lbOILO4pTeCuA0caDjgqWWoPkCT+OXXOPPjeA77nZnyPZr5vafA9j/lumI1vb7/otZcP9Kvz2/CtJnHc6bkzKGOnSO303KmU2bFpZtVOZHdYRk8kYWrNrJNXIMZJ4pfErAZV+uE19M86
R9SbXBcEzFHEfTk1Mg/m94L5BRnzFczcbDC3mLk9G/OB0qDohwdUpTbMrwPztfoeKTHOzrCTyp0aKdY4STlCBxUZMEHaNK7Nm7d3XNXUEObztUOSXepMBk/XhBUimUa8Q+WTi8yjnSiqhkcuW1ar1XJ8fRqo0U2NTxctMzehfR663Addypku
x7Iuow1dHNbFnU2XoXw5b5eFrcba6OIlFoFdjCvTemr74K9TGwiT/gLOjZ1vdNODWc2Z8jjUeoz0LiTdIXANMd3jwHVYIkL0kVPj82B9P1h7GevjmHWlwdpn1sGs+75ncAC5jK2qbVgfRmdhEHv6GoBXjW6MBAohfN2QElmhZIp368z3IQ8A
r8rwnsR4Q8LbFDSuQXDaoSK0IiyJmcIEUdDRG+ynEqoavm9QG3UrlUjPQcKn6viqv61XsVAX6kcuwv9NY58SV6od6q089iYe+2I9CkV+KE6NikhdQuPsRd/T6/GUprqUfqIqbHbbqibRtrW4KxpHvcDCZbpH14/qMnoUjQvU5US5EcI+BBGu
yERYzSJcSSKYm9UU9aL7wgLioc34MsY8ttDHBPdWxn0V4R7TYBe3AztSQoFHXU0dNcQxQjQ2HczDAHNNBuY0BnNtAuY6/BUaTQhZrqdpEZ7pyBTViBFchdB9sLoBP2zBFVhx92R9RhoXg+pGjf4mglooCH1D1lDiQUx+czb5CZi8uAdNlr51
MKLLheqW6WtI97XqVl7C21iK22n8xuXeWFtb1NaD48kW6g6alC7qxlqscYymGqNBocKdpAL+3kV/hTYsB3GtupvEdNYW92wWPXmBQt2T8VnIYt5L3R3cRav7GOz9Gqy+kVYP6M8Ufz/IPz6kG0aKB7RdUXOgr6dnuNdSD9M0LQH4I7QPktst
158I9BGUWu6rAq3OlbiL7Uz8GFy4TU+mTr8SkJeqOUJ48Ok6fkOgVo3DRsyiq7VxVd+EGetxlFFN31JpqkkXvWlVA2WFCRcDptUq9QiBnyPMfwS28Wim5XrW8jGtJcn1OMv1xKxy9fT3WmIIcj3ZRi66Z+drQpzDJpXVmlFmF4WkC5VAdVhD
ofqMSlHMq7V6lVA6Giap1FPz4P4ouD+dcT+LuT/T4P4sc39uVu791nBPvn9wQD3fhvvT4L4uWe+UWhp6mnxLqK9bdBzDtzR0AezoAhsdBSUX974U0VDUmjNWJoccPA7iW3qjQAcHFPVC3O4sIWqYY1gP4chbbgeSsKnklvV9O65h9Yw59cI8
VHsMqr0tU63Iqr29odo7WLV3zr7B+gfz+fJAXr2rjWpUSU83WIQYANUaujBOdGSTT65eSTOtD1fz9EsD+g0ro7MQdObUu+dB6HEQek9G6Fwm9N4GofcxoffPSmjAQliDnF19oA2h40FIh/WGBs+pHK0olWopCORLmcQDsOHTpte1ysxF5NQH
50HnCdD5UEbnPKbzYU2HSjcfYTof1XSmXRCrj6FNv3CCOjHcty9K6uNomlKfoD4ounwy+fsp/I3Up2mW5uLLk5j6M9nU5/PUn20o+Tme+vOzKlkSPdZgecBUX2ij5OvImQgPqS69e0M7ZDRIrrjYUlaoL85Do6cA9EsZ0AsY6IsNoF9moF+Z
FeigZZVEyTTVV9sApdgFNqyQg4QImb42D1BPA9TXM1AWg/pGA9RLDOqbs6tnC7zQUupX35oB1Bq8PULvWyAR+vY8QD0DUN/JQJUY1Hcb1vQ9BvX9Ntb0A7KmxhsH6ofakn6UWNCPk78/0Zb001ZLehbT/iybtszT/pymFWNpYNA+dPxF1m0d
d/ulRkuRwa8Y7a81Wo4MfqM/01H3W/7xd4m+B88Y640MDgz226V8n/p9G5FfRD/UKhoV4eSKj64eyMvbZLjIXRDVdwflbp2y4U4sTrO15LWoxJXxq1Jp7a4coBqNpaPzouUFIVQAqN6D+2u8cubqJdZvsikuCNALacqlV6t0cZtKXja9tQJU
ybtqCEJ83YW6TnvbLaf+MA9DeQ4r9sdM+jGW/k8kfVNesE7fw3SoP6Mdkv+FJf8rSa6D56Y3J57HgH/LBvR4wL9PN4FZAvJ/ZH0d7vsy9R1Lpv4nT/1Ku6lfwNT/elX3f+upp9R/8Df3/zE2Bvn6/P/OVNMVII20oqqi43v/`);
const EXPECTED_82 = [
  "",
  "",
  "",
  "",
  "transform popup_place:",
  "    xpos 0.1 xanchor 0.0 ypos 0.1 yanchor 0.0",
  "",
  "",
  "label tutorial_playing:",
  "",
  "    e \"As someone who has played more than a few visual novels, there are many features that I expect all games to have.\"",
  "",
  "    e \"Features like saving, loading, changing preferences, and so on.\"",
  "",
  "    e \"One of the nice things about Ren'Py is that the engine provides many of these features for you. You can spend your time creating your game, and let us provide these things.\"",
  "",
  "    e \"While you're in the game, you can access the game menu by right clicking or hitting the escape key.\"",
  "",
  "    e \"You can also access the game menu through some of the quick menu buttons at the bottom of this screen.\"",
  "",
  "    show eileen happy at right",
  "    show popup save at popup_place",
  "    with moveinleft",
  "",
  "    e \"When you first enter the game menu, you'll see the save screen. Clicking on a numbered slot will save the game.\"",
  "",
  "    e \"Unlike other engines, Ren'Py doesn't limit the number of save slots that you can use. You can keep hitting next until you reach the page you want.\"",
  "",
  "    e \"Clicking on the title of the page allows you to start typing to change the page name.\"",
  "",
  "    e \"The load screen looks quite similar to the save screen, and lets you load a game from a save slot.\"",
  "",
  "    e \"It also lets you load one of the auto-saves that Ren'Py makes for you.\"",
  "",
  "    show popup prefs at popup_place",
  "    with dissolve",
  "",
  "    e \"The game menu also has the preferences screen.\"",
  "",
  "    e \"This screen lets you decide how Ren'Py displays, pick what Ren'Py skips, control text speed and auto-click speed, and adjust sound, music, and voice volumes.\"",
  "",
  "    e \"The game menu also lets you end the game and return to the main menu, or quit Ren'Py entirely.\"",
  "",
  "    show popup hrpprefs at popup_place",
  "    with dissolve",
  "",
  "    e \"While the default game menus look a bit generic, with a little work they can be customized or even entirely replaced, allowing you to create menus as unique as your game.\"",
  "",
  "    hide popup",
  "    show eileen happy at center",
  "    with moveoutleft",
  "",
  "    e \"While inside the game, there are a few more things you can do.\"",
  "",
  "    e \"When I'm liking a visual novel, I want to see all the endings. Ren'Py's skip function lets me easily do this, by skipping text that I've already seen.\"",
  "",
  "    e \"I can skip a few lines by holding down Control, or I can toggle skip mode by clicking the skip button at the bottom of the screen.\"",
  "",
  "    e \"By default, we only skip read text, so this won't do anything the first time through the game.\"",
  "",
  "    e \"Clicking the auto button toggles auto-forward mode, which makes the game advance without you clicking.\"",
  "",
  "    e \"The Q.Save and Q.Load buttons provide a single-click way to make a save, and a fast way to load that save again.\"",
  "",
  "    e \"Pressing the 's' key saves a screenshot to disk, so I can upload pictures of the game to websites like {a=https://www.renpy.org}renpy.org{/a}.\"",
  "",
  "    e \"The history button displays a history of read text - but you can also use rollback, which is usually better.\"",
  "",
  "    menu:",
  "        e \"Would you like to hear about rollback?\"",
  "        \"Yes.\":",
  "",
  "",
  "",
  "            jump tutorial_rollback",
  "        \"No.\":",
  "",
  "",
  "            jump tutorial_rollback_done",
  "",
  "",
  "label tutorial_rollback:",
  "",
  "    e \"You can invoke a rollback by clicking the 'Back' button, scrolling the mouse wheel up, or by pushing the page up key. That'll bring you back to the previous screen.\"",
  "",
  "    e \"While at a previous screen, you can roll forward by scrolling the mouse wheel down, or pushing the page down key.\"",
  "",
  "    e \"Rolling forward through a menu will make the same choice you did last time. But you don't have to do that - Ren'Py's rollback system allows you to make a different choice.\"",
  "",
  "    e \"You can try it by rolling back through the last menu, and saying 'No'.\"",
  "",
  "    e \"Click back a few times, press page up, or scroll up the mouse wheel.\"",
  "",
  "    show eileen concerned",
  "",
  "    e \"Well, are you going to try it?\"",
  "",
  "    e \"Your loss.\"",
  "",
  "    e \"Moving on.\"",
  "",
  "    show eileen happy",
  "",
  "label tutorial_rollback_done:",
  "",
  "    e \"By allowing Ren'Py to take care of out-of-game issues like loading and saving, you can focus on making your game, while still giving players the experience they've come to expect when playing visual novels.\"",
  "",
  "    return",
].join('\n') + '\n';

const REAL_77 = unb64(`
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`);
const ORIGINAL_77 = [
  "example movie_image:",
  "    image launch = Movie(play=\"oa4_launch.webm\", pos=(10, 10), anchor=(0, 0))",
  "label tutorial_video:",
  "    e \"Ren'Py supports playing movies. There are two ways of doing this.\"",
  "    e \"The first way allows you to show a movie as an image, along with every other image that's displayed on the screen.\"",
  "    show example movie_image",
  "    e \"To do this, we first have to define an image to be a Movie displayable. Movie displayables take a movie to play, and can be given position properties.\"",
  "    stop music fadeout .25",
  "    show example movie_play",
  "    pause .25",
  "    example movie_play hide:",
  "        show launch behind eileen",
  "    e \"Then, we can show the movie displayable, which starts the movie playing.\"",
  "    example:",
  "        hide launch",
  "    e \"When we no longer want to play the movie, we can hide it.\"",
  "    show example movie_cutscene",
  "    e \"The other way to show a movie is with the renpy.movie_cutscene python function. This shows the movie fullscreen, either until it ends or until the user clicks.\"",
  "    hide screen example",
  "    example movie_cutscene hide:",
  "        $ renpy.movie_cutscene(\"oa4_launch.webm\")",
  "    e \"A Movie displayable can also take a mask with an alpha channel, which lets you make movie sprites. But that's more complicated, so I'll stop here for now.\"",
  "    play music \"sunflower-slow-drag.ogg\"",
  "    return",
];

const codeLines = text => text.split('\n').map(l => l.trimEnd()).filter(l => l.trim() && !l.trim().startsWith('#'));

test("real Ren'Py 8.2 script: output is byte-identical to unrpyc's expected output", () => {
  const r = decompileRpyc(REAL_82);
  assert.equal(r.source, EXPECTED_82);
  assert.equal(r.container, 'RPYC2');
  assert.equal(r.notDecompiled, 0);
  assert.deepEqual(r.notDecompiledClasses, {});
  assert.equal(r.statements, 54);
  assert.ok(r.atlNodes > 0);
  assert.equal(r.renpy.python, 3);
  assert.equal(r.renpy.scriptVersion, 5003000);
  assert.ok(r.renpy.hints.some(h => /Ren'Py 8/.test(h)));
  // an ATL transform, show/hide/with, a menu with its caption and jumps are in this file
  assert.match(r.source, /^transform /m);
  assert.match(r.source, /^ {4}menu:/m);
  assert.match(r.source, /^ {4}show popup save at popup_place\n {4}with moveinleft$/m);
  assert.match(r.source, /^ {8}e "Would you like to hear about rollback\?"\n {8}"Yes\.":$/m);
});

test("real Ren'Py 7.7 (Python 2) script: every line of the original source comes back", () => {
  const r = decompileRpyc(REAL_77);
  assert.deepEqual(codeLines(r.source), ORIGINAL_77);
  assert.equal(r.notDecompiled, 0);
  assert.equal(r.renpy.python, 2);
  assert.ok(r.renpy.hints.some(h => /Python 2/.test(h)));
  const file = readRpyc(REAL_77);
  assert.deepEqual(file.slots.map(s => s.slot), [1, 2]);
  assert.equal(file.pickle.protocol, 2);
});

// ---------------------------------------------------------------- stub-built: every statement form (not written by Ren'Py)
const F = 'game/script.rpy';
const t = py.tuple, s2 = py.str2, ex = py.expr;
const node = (name, line, attrs = {}) => py.obj(`renpy.ast.${name}`, { filename: s2(F), linenumber: line, ...attrs });
const atl = (name, line, attrs = {}) => py.obj(`renpy.atl.${name}`, { loc: t([F, line]), ...attrs });
const sl = (name, line, attrs = {}) => py.obj(`renpy.sl2.slast.${name}`, { location: t([F, line]), ...attrs });
const multi = (line, a = {}) => atl('RawMultipurpose', line, { warper: null, duration: '0', properties: [], expressions: [], splines: [], revolution: null, circles: '0', ...a });
const block = (line, statements, animation = false) => atl('RawBlock', line, { statements, animation });
const imspec = (name, { expr = null, tag = null, at = [], layer = null, zorder = null, behind = [] } = {}) => t([t(name), expr, tag, at, layer, zorder, behind]);
const disp = (line, cls, style, a = {}) => sl('SLDisplayable', line, { displayable: py.global(cls), style, positional: [], keyword: [], children: [], ...a });
const oldParams = (parameters, positional, extrapos = null, extrakw = null) => py.obj('renpy.ast.ParameterInfo', { parameters: parameters.map(p => t(p)), positional, extrapos, extrakw });
const oldArgs = (args, extrapos = null, extrakw = null) => py.obj('renpy.ast.ArgumentInfo', { arguments: args.map(a => t(a)), extrapos, extrakw });
const STUB_STMTS = [
  node('Init', 1, { priority: 500, block: [node('Image', 1, { imgname: t(['bg', 'room']), code: py.code('"room.png"', 1, 'eval'), atl: null })] }),
  node('Init', 2, { priority: 500, block: [node('Image', 2, { imgname: t(['logo', 'spin']), code: null, atl: block(3, [
    multi(3, { expressions: [t(['"logo.png"', null])] }),
    multi(4, { warper: 'linear', duration: '2.0', properties: [t(['rotate', '360'])] }),
    atl('RawRepeat', 5, { repeats: '3' }),
  ]) })] }),
  node('Init', 7, { priority: 0, block: [node('Transform', 7, { varname: 'pulse', parameters: oldParams([['t', '1.0']], ['t']), atl: block(8, [
    atl('RawParallel', 8, { blocks: [block(9, [multi(9, { warper: 'ease', duration: 't', properties: [t(['zoom', '1.1'])] })]), block(11, [multi(11, { duration: '0.5' })])] }),
    atl('RawChoice', 12, { choices: [t(['1.0', block(13, [multi(13, { properties: [t(['alpha', '1.0'])] })])]), t(['2.0', block(15, [multi(15, { properties: [t(['alpha', '0.5'])] })])])] }),
    atl('RawOn', 16, { handlers: { show: block(17, [multi(17, { warper: 'linear', duration: '0.2', properties: [t(['alpha', '1.0'])] })]), hide: block(19, [multi(19, { warper: 'linear', duration: '0.2', properties: [t(['alpha', '0.0'])] })]) } }),
    atl('RawChild', 20, { children: [block(21, [multi(21, { expressions: [t(['"glow.png"', 'dissolve'])] })])] }),
    atl('RawContainsExpr', 22, { expression: '"star.png"' }),
    atl('RawTime', 23, { time: '4.0' }),
    atl('RawFunction', 24, { expr: 'slide' }),
    atl('RawEvent', 25, { name: 'done' }),
    block(27, [atl('RawRepeat', 27, { repeats: null })]),
  ]) })] }),
  node('Init', 29, { priority: 0, block: [node('Define', 29, { varname: 'e', code: py.code('Character("Eileen")', 29, 'eval'), store: 'store' })] }),
  node('Init', 30, { priority: 2, block: [node('Define', 30, { varname: 'width', code: py.code('1280', 30, 'eval'), store: 'store.gui' })] }),
  node('Init', 31, { priority: 0, block: [node('Default', 31, { varname: 'points', code: py.code('0', 31, 'eval'), store: 'store' })] }),
  node('Init', 32, { priority: -1, block: [node('Python', 33, { hide: true, store: 'store.tools', code: py.code('\ndef twice(x):\n    return (x,\n            x)\n', 33) })] }),
  node('EarlyPython', 37, { hide: false, store: 'store', code: py.code('\nimport os\n', 38) }),
  node('Init', 40, { priority: 0, block: [node('Style', 40, { style_name: 'big_text', parent: 'default', clear: false, take: null, delattr: [], variant: null, properties: { size: ex('40', 41), color: ex('"#fff"', 42) } })] }),
  node('Init', 44, { priority: -500, block: [node('Screen', 44, { screen: sl('SLScreen', 44, { name: 'stats', tag: 'menu', parameters: oldParams([['who', null], ['extra', 'None']], ['who'], 'rest', 'kw'), keyword: [t(['modal', ex('True', 46)])], children: [
    sl('SLDefault', 47, { variable: 'page', expression: '0' }),
    sl('SLPython', 48, { code: py.code('total = len(rest)', 48) }),
    disp(49, 'renpy.display.layout.Window', 'frame', { keyword: [t(['xalign', ex('0.5', 49)])], children: [
      disp(50, 'renpy.display.layout.MultiBox', 'vbox', { children: [
        disp(51, 'renpy.text.text.Text', 'text', { positional: ['who.name'], keyword: [t(['size', ex('30', 51)])], variable: 'title' }),
        sl('SLFor', 52, { variable: '_sl2_i', expression: 'who.items', keyword: [], children: [
          sl('SLPython', 52, { code: py.code('k, v  = _sl2_i', 52) }),
          sl('SLIf', 53, { entries: [t([ex('v > 0', 53), sl('SLBlock', 53, { keyword: [], children: [disp(54, 'renpy.ui._textbutton', 'button', { positional: ['k'], keyword: [t(['action', ex('Return(k)', 54)])] })] })]), t([null, sl('SLBlock', 55, { keyword: [], children: [disp(56, 'renpy.display.layout.Null', 'default', { keyword: [t(['height', ex('10', 56)])] })] })])] }),
        ] }),
        sl('SLShowIf', 57, { entries: [t([ex('total', 57), sl('SLBlock', 57, { keyword: [], children: [disp(58, 'renpy.sl2.sldisplayables.sl2add', null, { positional: ['"badge.png"'], atl_transform: block(60, [multi(60, { warper: 'linear', duration: '1.0', properties: [t(['alpha', '1.0'])] })]) })] })])] }),
        sl('SLUse', 61, { target: 'footer', args: oldArgs([[null, 'page'], ['compact', 'True']]), id: null, block: sl('SLBlock', 61, { keyword: [], children: [sl('SLTransclude', 62)] }) }),
        disp(63, 'game.Gauge', 'gauge', { positional: ['points'] }),
      ] }),
    ] }),
  ] }) })] }),
  node('Label', 65, { name: 'start', parameters: oldParams([['a', null], ['b', '2']], ['a', 'b'], 'rest'), hide: false, block: [
    node('With', 66, { expr: 'None', paired: ex('fade', 66) }),
    node('Scene', 66, { imspec: imspec(['bg', 'room']), layer: 'master', atl: null }),
    node('With', 66, { expr: ex('fade', 66), paired: null }),
    node('Show', 67, { imspec: imspec(['eileen', 'happy'], { tag: 'e', at: ['left'], layer: 'master2', zorder: '2', behind: ['desk'] }), atl: null }),
    node('Show', 68, { imspec: imspec([], { expr: 'pic' }), atl: block(69, [multi(69, { properties: [t(['xalign', '0.5'])] })]) }),
    node('ShowLayer', 70, { layer: 'master', at_list: ['shake'], atl: null }),
    node('Camera', 71, { layer: 'ui', at_list: [], atl: block(72, [multi(72, { properties: [t(['zoom', '2.0'])] })]) }),
    node('Say', 73, { who: 'e', what: 'Hi, "you".\nSecond line.', with_: null, interact: true, attributes: t(['happy']), arguments: null }),
    node('Say', 74, { who: null, what: 'Narration.', with_: 'vpunch', interact: true, attributes: null }),
    node('With', 75, { expr: 'dissolve', paired: null }),
    node('Hide', 76, { imspec: imspec(['eileen']) }),
    node('While', 77, { condition: ex('points < 3', 77), block: [node('Python', 78, { hide: false, store: 'store', code: py.code('points += 1', 78) })] }),
    node('Label', 79, { name: 'choice', parameters: null, block: [] }),
    node('Say', 82, { who: 'e', what: 'Pick one.', with_: null, interact: false, attributes: null }),
    node('Menu', 79, { items: [t(['Go', ex('points > 2', 83), [node('Jump', 84, { target: 'ending', expression: false })]]), t(['Stay', 'True', [node('Call', 86, { label: 'side', expression: false, arguments: oldArgs([[null, '1'], ['mood', '"calm"']], 'more', 'opts') }), node('Label', 86, { name: 'after_side', parameters: null, block: [] }), node('Pass', 86), node('Call', 87, { label: 'target', expression: true, arguments: null }), node('Pass', 87), node('Jump', 88, { target: 'where', expression: true })]]), t(['Just a caption', 'True', null])], set: 'seen', with_: 'dissolve' }),
    node('If', 90, { entries: [t([ex('a', 90), [node('Pass', 91)]]), t([ex('b', 92), [node('Return', 93, { expression: ex('b', 93) })]]), t(['True', [node('UserStatement', 95, { line: 'play music "theme.ogg"', block: [] })]])] }),
    node('UserStatement', 96, { line: 'layeredthing x:', block: [t([F, 97, 'always "a.png"', []]), t([F, 98, 'group g:', [t([F, 99, 'attribute on', []])]])] }),
    node('Mystery', 100, { payload: 1 }),
  ] }),
  node('Translate', 102, { identifier: 'start_0a1b2c3d', language: 'french', block: [node('Say', 103, { who: 'e', what: 'Salut.', with_: null, interact: true, attributes: null })] }),
  node('EndTranslate', 103),
  node('TranslateSay', 105, { identifier: 'start_11223344', language: 'german', who: 'e', what: 'Hallo.', with_: null, interact: true, attributes: null }),
  node('Init', 107, { priority: 0, block: [node('TranslateString', 108, { language: 'french', old: 'Go', new: 'Aller', newloc: t([F, 109]) }), node('TranslateString', 110, { language: 'french', old: 'Stay', new: 'Rester "ici"', newloc: t([F, 111]) })] }),
  node('TranslateBlock', 113, { language: 'french', block: [node('Style', 113, { style_name: 'big_text', parent: null, clear: false, take: null, delattr: [], variant: null, properties: { size: ex('36', 113) } })] }),
  node('Return', 113, { expression: null }),
];
const STUB_EXPECTED = [
  "image bg room = \"room.png\"",
  "image logo spin:",
  "    \"logo.png\"",
  "    linear 2.0 rotate 360",
  "    repeat 3",
  "",
  "transform pulse(t=1.0):",
  "    parallel:",
  "        ease t zoom 1.1",
  "    parallel:",
  "        pause 0.5",
  "    choice:",
  "        alpha 1.0",
  "    choice 2.0:",
  "        alpha 0.5",
  "    on show:",
  "        linear 0.2 alpha 1.0",
  "    on hide:",
  "        linear 0.2 alpha 0.0",
  "    contains:",
  "        \"glow.png\" with dissolve",
  "    contains \"star.png\"",
  "    time 4.0",
  "    function slide",
  "    event done",
  "    block:",
  "        repeat",
  "",
  "define e = Character(\"Eileen\")",
  "define 2 gui.width = 1280",
  "default points = 0",
  "init -1:",
  "    python hide in tools:",
  "        def twice(x):",
  "            return (x,",
  "            x)",
  "python early:",
  "    import os",
  "",
  "style big_text is default:",
  "    size 40",
  "    color \"#fff\"",
  "",
  "screen stats(who, *rest, extra=None, **kw):",
  "    tag menu",
  "    modal True",
  "    default page = 0",
  "    $ total = len(rest)",
  "    frame xalign 0.5:",
  "        has vbox",
  "        text who.name size 30 as title",
  "        for k, v in who.items:",
  "            if v > 0:",
  "                textbutton k action Return(k)",
  "            else:",
  "                null height 10",
  "        showif total:",
  "            add \"badge.png\":",
  "",
  "                at transform:",
  "                    linear 1.0 alpha 1.0",
  "        use footer(page, compact=True):",
  "            transclude",
  "        gauge points",
  "label start(a, b=2, *rest):",
  "    scene bg room with fade",
  "    show eileen happy as e behind desk onlayer master2 zorder 2 at left",
  "    show expression pic:",
  "        xalign 0.5",
  "    show layer master at shake",
  "    camera ui:",
  "        zoom 2.0",
  "    e happy \"Hi, \\\"you\\\".\\nSecond line.\"",
  "    \"Narration.\" with vpunch",
  "    with dissolve",
  "    hide eileen",
  "    while points < 3:",
  "        $ points += 1",
  "    menu choice:",
  "        with dissolve",
  "        set seen",
  "        e \"Pick one.\"",
  "        \"Go\" if points > 2:",
  "            jump ending",
  "        \"Stay\":",
  "            call side (1, mood=\"calm\", *more, **opts) from after_side",
  "            call expression target",
  "            jump expression where",
  "        \"Just a caption\"",
  "    if a:",
  "        pass",
  "    elif b:",
  "        return b",
  "    else:",
  "        play music \"theme.ogg\"",
  "    layeredthing x:",
  "        always \"a.png\"",
  "        group g:",
  "            attribute on",
  "    # renpy.ast.Mystery (not decompiled), line 100",
  "",
  "translate french start_0a1b2c3d:",
  "    e \"Salut.\"",
  "",
  "translate german start_11223344:",
  "    e \"Hallo.\"",
  "translate french strings:",
  "    old \"Go\"",
  "    new \"Aller\"",
  "    old \"Stay\"",
  "    new \"Rester \\\"ici\\\"\"",
  "",
  "translate french style big_text size 36",
  "",
].join('\n');

test('stub-built script (7.4-style shapes): every statement form, screens, ATL and translations', () => {
  const r = decompileRpyc(buildRpyc(STUB_STMTS));
  assert.equal(r.source, STUB_EXPECTED);
  assert.equal(r.notDecompiled, 1);
  assert.deepEqual(r.notDecompiledClasses, { 'renpy.ast.Mystery': 1 });
  assert.match(r.source, /^ {4}# renpy\.ast\.Mystery \(not decompiled\), line 100$/m);
  assert.equal(r.customDisplayables, 1);
  assert.match(r.warnings[0], /game\.Gauge/);
  assert.ok(r.renpy.hints.some(h => /ParameterInfo: Ren'Py 7\.4 or older/.test(h)));
  assert.equal(r.renpy.python, 2);
});

test('legacy container without header (whole file is the zlib pickle) and a script in another slot', () => {
  const legacy = decompileRpyc(buildRpyc(STUB_STMTS, { legacy: true }));
  assert.equal(legacy.source, STUB_EXPECTED);
  assert.match(legacy.container, /^RPYC1/);
  assert.ok(legacy.renpy.hints.some(h => /legacy container/.test(h)));
  assert.throws(() => readRpyc(buildRpyc(STUB_STMTS, { slot: 7 })), /no slot 1 \(slots: 7\)/);
});

// Made with Python 3.13's pickle module, protocol 5, from stub classes (see the header). Opcodes inside: PROTO FRAME
// MEMOIZE STACK_GLOBAL SHORT_BINUNICODE NEWOBJ REDUCE BUILD (tuple state) FROZENSET LONG1 SHORT_BINBYTES TUPLE2 BINGET.
const STUB_84 = unb64(`
UkVOUFkgUlBDMgEAAAAiAAAA5gMAAAAAAAAAAAAAAAAAAHjabVXfb+NEEM4PO07T9tq70hMSErLyVE4oXCMkxAMI6IGuTS6KLhXigVKt7U12Fcc2u+s2BlWCl+gOVkjV7b3wiJD4Y/gD+Fd4osxucnHc1JIde/fbmW9mvpn8ZL/+0ymZ60odSOcCM07jSJ38+3W3JKtjnClZT6Mw9sc4ULLq0ZH6ZaO0uD6TlhfGnjqqlMpK1oYs/gFHYKaM1LVKz+Btg+EoyVqICyWt44gK9Uq997PqaWeNkEY4SiceZqpTlranvagzVThU62eCAKHlMbILWMuPA7wGPNKLBngAmKYLF50kMRPuBAnS0N/A3/3EbbuPHrkfPW4ouTNCE/wB9xlNRIslmepUZsAUT7GvOtVnHz/ulITypEUomH6RzpSH9INs52xscv825yd4CKEVONuQW8Qi8KakHdIJZIK8Td5ZcN1dnuZpohmbeL6cJgyMHMjaj4fvu+0rRd7t2J1qp6RJPTdfhuwFClfI3knSkfWE0ZhRkamTrf9ubtZJD3yGcTHRjqzx+arcmUN52IbbHKgPurePyDqUEAktICDnaHLziKskBfU4IKfLmAW6xnWf0DAAo/pj3fj2oPuE8iREGfLC1UyegOE6GN4MVrblW3MDi7UW3HGqKT5LQ0G/iKdgQNpcZBprXXiwIBtJzKmmCsk7U6QHNByeIJ9GI0XaoOEPdQz1PN0zhUgfkKerVDZminzzhr/AU2Ee4ORU/7xS5FtpmRXyHTiwmk/7TTADzrSpZaXMY/lSKIvdRR4OC1XZJF0dDNIqaSSIQYYFtO0yjcslKPCAjiIkUpankFxpK/W7wP3le+6uC1BrTKNAdUqGXNlTZJbv/kpegn6dAA8R5FrJctuEJS3ERryAvAZkZW7CL2y8ho0q+U1avRiaxiAq48sC5HeAWCZJXAv7/u3RUh2grJCjLVm9JDHQ0QW/JEhL6ikOw9h1BcEMt0AcADgf6uMvZAPaOxJ0SHUeHJPb80Ml9/A0CalPxfnKvpkC5I/c1zb5S+71EGNG+W7z+zQWOGhqFzSCbCJfqJfm0H5+6N5K9ztTmEl6soKg7oGg3GIzFyKtHA8Lge5IB5gxijmo+EAL1566n7qH2tZOLt5bzW6dpJOkYGdX1iDqEdabwZs6IN3BpyzFam2WH6GwqMoHMNaMVGWVpx64A2vpBLjdKcytzxe7x9EwzrX5D/jpme4zATxY7T5ZHs8bs722hfnsjlRZfcR5bhsoahgG+Bp086tUN8kp0d2/GtWedBKUhTEKdKWuTVbMcZLloH1Q6N/rA/U5BpvFgfpQNkBSDHPzJ2uimepoHubR5OP7Zkl8f0G89T+Jee7D`);
const STUB_84_EXPECTED = [
  "init python hide:",
  "    import math",
  "    big = 2 ** 70",
  "",
  "define limit = {1, 2}",
  "",
  "screen hud:",
  "    vbox spacing 4:",
  "        text \"HP\"",
  "",
  "label start(a, /, b=2, *args, c=None, **kw):",
  "    e \"Hello \\ there.\" id start_1",
  "    \"Narration \\\"quoted\\\".\" nointeract",
  "    $ x = big",
  "    if x > 1:",
  "        jump done",
  "    else:",
  "        call sub (1, k=2)",
  "    # renpy.ast.FutureThing (not decompiled), line 19",
  "",
  "label done:",
  "    return x",
  "",
].join('\n');

test('stub-built script (8.4+ shapes, pickle protocol 5): slot state tuples, astsupport.PyExpr, indented python', () => {
  const r = decompileRpyc(STUB_84);
  assert.equal(r.source, STUB_84_EXPECTED);
  assert.deepEqual(r.notDecompiledClasses, { 'renpy.ast.FutureThing': 1 });
  assert.equal(r.renpy.pickleProtocol, 5);
  assert.ok(r.renpy.hints.some(h => /8\.4 or newer/.test(h)));
  const { data } = readRpyc(STUB_84);
  assert.equal(data.get('big'), 2n ** 70n);
  assert.deepEqual([...data.get('blob')], [0, 1]);
  assert.deepEqual([...data.get('frozen')], ['a']);
});

// ---------------------------------------------------------------- pickle reader, objects mode
test('unpickle objects mode: classes become data, nothing is called', () => {
  const v = unpickle(buildPickle({ run: py.reduce('os.system', ['echo no']), node: py.obj('renpy.ast.Jump', { target: 'x', __proto__x: 1 }), expr: py.expr('a + b', 12), old: py.str2('caf\xe9'),
    set: py.set([1, 2]), big: -(2n ** 65n), f: 1.5, t: py.tuple([true, false, null]), code: py.code('x = 1', 3), odict: py.reduce('collections.OrderedDict', [[py.tuple(['k', 1])]]),
    rlist: py.newobj('renpy.revertable.RevertableList', []), keyed: new Map([[py.tuple([1, 2]), 'pair'], [10, 'ten'], [2, 'two']]) }), { objects: true });
  assert.ok(v instanceof Map);
  assert.ok(v.get('run') instanceof PyObj);
  assert.equal(v.get('run').$class, 'os.system');
  assert.deepEqual(v.get('run').$args, ['echo no']);
  assert.equal(v.get('node').$class, 'renpy.ast.Jump');
  assert.equal(v.get('node').target, 'x');
  assert.equal(`${v.get('expr')}`, 'a + b');
  assert.equal(v.get('expr').linenumber, 12);
  assert.equal(v.get('old'), 'caf\xe9');
  assert.deepEqual([...v.get('set')], [1, 2]);
  assert.equal(v.get('big'), -(2n ** 65n));
  assert.equal(v.get('f'), 1.5);
  assert.deepEqual(v.get('t'), [true, false, null]);
  assert.equal(v.get('code').$state[1], 'x = 1');
  assert.deepEqual([...v.get('odict')], [['k', 1]]);
  assert.deepEqual(v.get('rlist'), []);
  assert.deepEqual([...v.get('keyed').values()], ['pair', 'ten', 'two']); // insertion order, keys keep their type
  const info = {};
  unpickle(buildPickle(py.obj('renpy.ast.Pass')), { objects: true, info });
  assert.equal(info.protocol, 2);
  assert.ok(info.globals.has('renpy.ast.Pass'));
});

test('unpickle objects mode: protocol 0 text opcodes, NEWOBJ_EX, EXT and persistent ids', () => {
  // protocol 0: (dp0 S'a' p1 I1 s Vé p2 L5L s I01 ... as Python 2 writes it
  const p0 = Buffer.from("(dp0\nS'a\\x41'\np1\nI1\nsVb\\u00e9\np2\nL5L\nsS'c'\nI01\nsS'd'\nF1.5\ns.", 'latin1');
  const d = unpickle(p0, { objects: true });
  assert.deepEqual([...d], [['aA', 1], ['bé', 5], ['c', true], ['d', 1.5]]);
  // NEWOBJ_EX(cls, args, kwargs), EXT1, BINPERSID, EMPTY_SET + ADDITEMS
  const body = Buffer.concat([Buffer.from([0x80, 4, 0x5d, 0x28]), pickleValue(py.global('renpy.x.Thing')), pickleValue(py.tuple([1])), pickleValue({ k: 2 }), Buffer.from([0x92]),
    Buffer.from([0x82, 7]), pickleValue('pid'), Buffer.from([0x51]), Buffer.from([0x8f, 0x28]), pickleValue(3), Buffer.from([0x90]), Buffer.from([0x65, 0x2e])]);
  const [obj, ext, pers, set] = unpickle(body, { objects: true });
  assert.equal(obj.$class, 'renpy.x.Thing');
  assert.deepEqual(obj.$args, [1]);
  assert.equal(obj.$kwargs.get('k'), 2);
  assert.equal(ext.__global__, 'copyreg.extension.7');
  assert.equal(pers.$class, '(persistent id)');
  assert.deepEqual([...set], [3]);
});

test('unpickle rejects truncated and malformed input instead of reading past the end', () => {
  const good = buildPickle({ a: 'text', b: [1, 2, 3] });
  for (let cut = 1; cut < good.length; cut++) assert.throws(() => unpickle(good.subarray(0, cut), { objects: true }), /pickle/);
  assert.throws(() => unpickle(Buffer.from([0x80, 2, 0x58, 0xff, 0xff, 0xff, 0x7f, 0x41, 0x2e]), { objects: true }), /ended early/);
  assert.throws(() => unpickle(Buffer.from([0x80, 2, 0x75, 0x2e]), { objects: true }), /MARK missing/);
  assert.throws(() => unpickle(Buffer.from([0x80, 2, 0x86, 0x2e]), { objects: true }), /stack empty/);
  assert.throws(() => unpickle(Buffer.from([0x80, 2, 0xff]), { objects: true }), /opcode 0xff/);
});

// ---------------------------------------------------------------- printer details
test('printer details: parameter styles, python line splitting, short and long init forms', () => {
  assert.deepEqual(splitLogicalLines('a = (1,\n     2)\nb = """x\ny"""\n# c (\nd = 1 \\\n  + 2\n'), ['a = (1,\n     2)', 'b = """x\ny"""', '# c (', 'd = 1 \\\n  + 2']);
  const asObj = v => unpickle(buildPickle(v), { objects: true });
  // 7.5-8.1 ParameterInfo: positional_only / keyword_only lists next to parameters
  assert.equal(reconstructParaminfo(asObj(py.obj('renpy.parameter.ParameterInfo', { parameters: [py.tuple(['a', null]), py.tuple(['b', '1']), py.tuple(['c', null])], positional: ['a', 'b'],
    positional_only: [py.tuple(['a', null])], keyword_only: [py.tuple(['c', null])], extrapos: null, extrakw: 'kw' }))), '(a, /, b=1, *, c, **kw)');
  const node = (name, line, attrs = {}) => py.obj(`renpy.ast.${name}`, { linenumber: line, ...attrs });
  const print = stmts => printRenpyAst(asObj(stmts));
  // one python block in an init: "init python:"; two statements: "init:" with a block; a priority is kept
  const r = print([
    node('Init', 1, { priority: 0, block: [node('Python', 1, { code: py.code('\nx = 1\n', 1), hide: false, store: 'store' })] }),
    node('Init', 4, { priority: 10, block: [node('Python', 5, { code: py.code('y = 2', 5) }), node('Python', 6, { code: py.code('z = 3', 6) })] }),
    node('Init', 8, { priority: 990, block: [node('Image', 8, { imgname: py.tuple(['a']), code: py.code('"a.png"', 8, 'eval'), atl: null })] }),
    node('Init', 9, { priority: -500, block: [node('Screen', 9, { screen: py.obj('renpy.screenlang.ScreenLangScreen', { name: 'old' }) })] }),
    node('Define', 10, { varname: 'loose', code: py.code('1', 10, 'eval') }),
  ]);
  assert.equal(r.source, 'init python:\n    x = 1\n\ninit 10:\n    $ y = 2\n    $ z = 3\n\ninit 990 image a = "a.png"\n# renpy.screenlang.ScreenLangScreen (not decompiled), line 9\ndefine loose = 1\n');
  assert.deepEqual(r.notDecompiledClasses, { 'renpy.screenlang.ScreenLangScreen': 1 });
  assert.match(r.warnings.join('\n'), /needs an init block/);
  // values that are not nodes at all are reported the same way, never dropped
  const odd = print([null, 'text', node('Pass', 3)]);
  assert.equal(odd.notDecompiled, 2);
  assert.deepEqual(odd.notDecompiledClasses, { '(none)': 1, '(string)': 1 });
  assert.match(odd.source, /# \(none\) \(not decompiled\)\n# \(string\) \(not decompiled\)\n+pass\n$/);
});

// ---------------------------------------------------------------- re_decode and re_archive
test('re_decode: one .rpyc file, and a folder keeping relative paths', async () => {
  const dir = await tempDir();
  const game = path.join(dir, 'game');
  await fs.mkdir(path.join(game, 'chapters', 'one'), { recursive: true });
  await fs.writeFile(path.join(game, 'chapters', 'one', 'playing.rpyc'), REAL_82);
  await fs.writeFile(path.join(game, 'video.rpyc'), REAL_77);
  await fs.writeFile(path.join(game, 'module.rpymc'), buildRpyc(STUB_STMTS, { legacy: true }));
  await fs.writeFile(path.join(game, 'broken.rpyc'), REAL_82.subarray(0, 400));
  await fs.writeFile(path.join(game, 'notes.txt'), 'not a script');
  const before = await fs.readFile(path.join(game, 'video.rpyc'));

  const one = await decodeTool({ path: path.join(game, 'chapters', 'one', 'playing.rpyc'), out: path.join(dir, 'one') });
  assert.equal(one.decoded, 1);
  assert.equal(one.files[0].decoded, 'playing.rpy');
  assert.equal(one.files[0].statements, 54);
  assert.equal(one.files[0].notDecompiled, 0);
  assert.equal(await fs.readFile(path.join(dir, 'one', 'playing.rpy'), 'utf8'), EXPECTED_82);
  assert.match(one.next, /1 Ren'Py script\(s\) written as \.rpy/);
  assert.match(one.next, /Every node was decompiled/);

  const all = await decodeTool({ path: game, out: path.join(dir, 'all') });
  assert.equal(all.decoded, 3);
  assert.deepEqual(all.byKind, { rpy: 2, rpym: 1 });
  assert.deepEqual(all.files.map(f => f.decoded.split(path.sep).join('/')).sort(), ['chapters/one/playing.rpy', 'module.rpym', 'video.rpy']);
  assert.equal(await fs.readFile(path.join(dir, 'all', 'chapters', 'one', 'playing.rpy'), 'utf8'), EXPECTED_82);
  assert.equal(await fs.readFile(path.join(dir, 'all', 'module.rpym'), 'utf8'), STUB_EXPECTED);
  assert.equal(all.renpy.files, 3);
  assert.equal(all.renpy.statements, all.files.reduce((a, f) => a + f.statements, 0));
  assert.equal(all.renpy.notDecompiled, 1);
  assert.deepEqual(all.renpy.notDecompiledClasses, { 'renpy.ast.Mystery': 1 });
  assert.ok(all.renpy.versionHints.some(h => /Python 2/.test(h)));
  assert.match(all.next, /renpy\.ast\.Mystery ×1/);
  assert.deepEqual(all.skipped.map(s => s.file), ['broken.rpyc']);
  assert.match(all.skipped[0].reason, /rpyc/);
  // read-only on the input: nothing is written next to the scripts
  assert.deepEqual((await fs.readdir(game)).sort(), ['broken.rpyc', 'chapters', 'module.rpymc', 'notes.txt', 'video.rpyc']);
  assert.deepEqual(await fs.readFile(path.join(game, 'video.rpyc')), before);
  await fs.rm(dir, { recursive: true, force: true });
});

test("re_archive on an .rpa points at re_decode for the .rpyc inside, and the extracted folder decodes", async () => {
  const dir = await tempDir();
  const key = 0x42424242;
  const header = Buffer.alloc(34);
  const index = zlib.deflateSync(buildPickle({ 'scripts/playing.rpyc': [py.tuple([(header.length ^ key) >>> 0, (REAL_82.length ^ key) >>> 0, py.str2('')])] }));
  header.write(`RPA-3.0 ${(header.length + REAL_82.length).toString(16).padStart(16, '0')} ${key.toString(16).padStart(8, '0')}\n`, 0, 'latin1');
  const file = path.join(dir, 'scripts.rpa');
  await fs.writeFile(file, Buffer.concat([header, REAL_82, index]));
  const list = await archiveTool({ file });
  assert.equal(list.renpy.compiledScripts, 1);
  assert.match(list.next, /re_decode/);
  assert.match(list.renpy.note, /re_decode/);
  const ex = await archiveTool({ file, action: 'extract', out: path.join(dir, 'x') });
  assert.equal(ex.extracted, 1);
  const dec = await decodeTool({ path: path.join(dir, 'x'), out: path.join(dir, 'rpy') });
  assert.equal(await fs.readFile(path.join(dir, 'rpy', 'scripts', 'playing.rpy'), 'utf8'), EXPECTED_82);
  assert.equal(dec.renpy.files, 1);
  await fs.rm(dir, { recursive: true, force: true });
});

test('identify names an RPYC2 file; a damaged container is an error, not a guess', () => {
  assert.equal(identify(REAL_82).id, 'renpy-rpyc');
  assert.throws(() => readRpyc(REAL_82.subarray(0, 200)), /BAD_FORMAT|outside the file|zlib/);
  const outside = Buffer.from(REAL_82); outside.writeUInt32LE(0x7fffffff, 18);
  assert.throws(() => readRpyc(outside), /outside the file/);
  assert.throws(() => readRpyc(Buffer.from('not an rpyc at all')), /no zlib data/);
  assert.throws(() => readRpyc(zlib.deflateSync(buildPickle('just a string'))), /not \(data, statements\)/);
});
