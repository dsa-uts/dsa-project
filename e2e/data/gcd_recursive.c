// Find the greatest common divisor of the two integers, n and m.
int gcd_recursive(int n, int m)
{
  if (m <= 0)
    return n;

  int tmp;
  n = n % m;
  // swap n and m
  tmp = n;
  n = m;
  m = tmp;
  return gcd_recursive(n, m);
}
